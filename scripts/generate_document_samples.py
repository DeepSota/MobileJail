#!/usr/bin/env python3
"""Generate realistic document seeds for ``public/sdcard/Documents``.

The generated files deliberately cover both current Office Open XML formats and
their legacy binary counterparts.  LibreOffice is used as the document engine
so the fixtures exercise the same parsers as real user documents instead of
being extension-only placeholders.
"""

from __future__ import annotations

import argparse
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Sequence

try:
    import uno
    from com.sun.star.beans import PropertyValue
    from com.sun.star.text.ControlCharacter import PARAGRAPH_BREAK
except ImportError as exc:  # pragma: no cover - depends on the host office install
    raise SystemExit(
        "缺少 LibreOffice Python UNO 绑定。请安装 LibreOffice/pyuno 后重试。"
    ) from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "public" / "sdcard" / "Documents"
MAX_FIXTURE_BYTES = 1024 * 1024
FONT_NAME = "Noto Sans CJK SC"


def _property(name: str, value: Any) -> Any:
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


def _set_if_supported(obj: Any, name: str, value: Any) -> None:
    try:
        setattr(obj, name, value)
    except Exception:
        # Older LibreOffice builds expose a slightly smaller property surface.
        pass


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@contextmanager
def libreoffice_desktop() -> Iterator[Any]:
    """Start an isolated headless LibreOffice instance and yield its desktop."""

    executable = shutil.which("libreoffice") or shutil.which("soffice")
    if not executable:
        raise RuntimeError("未找到 libreoffice/soffice，无法生成真实 Office 样例")

    port = _free_port()
    with tempfile.TemporaryDirectory(prefix="mobilegym-office-") as profile:
        profile_url = Path(profile).resolve().as_uri()
        accept = (
            f"socket,host=127.0.0.1,port={port};"
            "urp;StarOffice.ComponentContext"
        )
        process = subprocess.Popen(
            [
                executable,
                "--headless",
                "--invisible",
                "--nologo",
                "--nodefault",
                "--nofirststartwizard",
                "--norestore",
                f"--accept={accept}",
                f"-env:UserInstallation={profile_url}",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        desktop = None
        try:
            local_context = uno.getComponentContext()
            resolver = local_context.ServiceManager.createInstanceWithContext(
                "com.sun.star.bridge.UnoUrlResolver", local_context
            )
            last_error: Exception | None = None
            for _ in range(60):
                if process.poll() is not None:
                    raise RuntimeError(
                        f"LibreOffice 启动失败，退出码 {process.returncode}"
                    )
                try:
                    remote_context = resolver.resolve(
                        f"uno:socket,host=127.0.0.1,port={port};"
                        "urp;StarOffice.ComponentContext"
                    )
                    desktop = remote_context.ServiceManager.createInstanceWithContext(
                        "com.sun.star.frame.Desktop", remote_context
                    )
                    break
                except Exception as exc:  # pragma: no cover - startup timing varies
                    last_error = exc
                    time.sleep(0.2)
            if desktop is None:
                raise RuntimeError("连接 LibreOffice 超时") from last_error
            yield desktop
        finally:
            if desktop is not None:
                try:
                    desktop.terminate()
                except Exception:
                    pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)


def _new_document(desktop: Any, factory: str) -> Any:
    document = desktop.loadComponentFromURL(
        f"private:factory/{factory}",
        "_blank",
        0,
        (_property("Hidden", True),),
    )
    if document is None:
        raise RuntimeError(f"LibreOffice 无法创建 {factory} 文档")
    return document


def _store(document: Any, output_path: Path, filter_name: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    document.storeToURL(
        uno.systemPathToFileUrl(str(output_path.resolve())),
        (
            _property("FilterName", filter_name),
            _property("Overwrite", True),
        ),
    )
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise RuntimeError(f"生成失败或文件为空：{output_path}")


def _close(document: Any) -> None:
    try:
        document.close(True)
    except Exception:
        document.dispose()


def _append_paragraph(
    document: Any,
    value: str,
    *,
    size: float = 11,
    bold: bool = False,
    color: int = 0x202124,
    centered: bool = False,
    bottom_margin: int = 180,
) -> None:
    text = document.Text
    cursor = text.createTextCursorByRange(text.End)
    _set_if_supported(cursor, "CharFontName", FONT_NAME)
    _set_if_supported(cursor, "CharFontNameAsian", FONT_NAME)
    _set_if_supported(cursor, "CharHeight", size)
    _set_if_supported(cursor, "CharHeightAsian", size)
    _set_if_supported(cursor, "CharWeight", 150.0 if bold else 100.0)
    _set_if_supported(cursor, "CharWeightAsian", 150.0 if bold else 100.0)
    _set_if_supported(cursor, "CharColor", color)
    _set_if_supported(cursor, "ParaAdjust", 3 if centered else 0)
    _set_if_supported(cursor, "ParaBottomMargin", bottom_margin)
    text.insertString(cursor, value, False)
    text.insertControlCharacter(cursor, PARAGRAPH_BREAK, False)


def _insert_table(document: Any, rows: Sequence[Sequence[str]]) -> None:
    if not rows:
        return
    column_count = len(rows[0])
    if any(len(row) != column_count for row in rows):
        raise ValueError("表格每一行的列数必须一致")

    table = document.createInstance("com.sun.star.text.TextTable")
    table.initialize(len(rows), column_count)
    cursor = document.Text.createTextCursorByRange(document.Text.End)
    document.Text.insertTextContent(cursor, table, False)
    _set_if_supported(table, "BackTransparent", False)

    for row_index, row in enumerate(rows, start=1):
        for column_index, value in enumerate(row):
            cell_name = f"{chr(ord('A') + column_index)}{row_index}"
            cell = table.getCellByName(cell_name)
            cell.String = value
            cell_cursor = cell.createTextCursor()
            _set_if_supported(cell_cursor, "CharFontName", FONT_NAME)
            _set_if_supported(cell_cursor, "CharFontNameAsian", FONT_NAME)
            _set_if_supported(cell_cursor, "CharHeight", 10.0)
            if row_index == 1:
                _set_if_supported(cell, "BackColor", 0xE8F0FE)
                _set_if_supported(cell_cursor, "CharWeight", 150.0)

    _set_if_supported(table, "BottomMargin", 300)
    end_cursor = document.Text.createTextCursorByRange(document.Text.End)
    document.Text.insertControlCharacter(end_cursor, PARAGRAPH_BREAK, False)


def _set_document_metadata(document: Any, title: str, subject: str) -> None:
    properties = document.DocumentProperties
    properties.Title = title
    properties.Subject = subject
    properties.Author = "mobile-gym 模拟文档"
    properties.Description = "用于移动端文件查看与分享流程测试的虚构样例"


def generate_writer_documents(desktop: Any, output_dir: Path) -> None:
    weekly = _new_document(desktop, "swriter")
    try:
        _set_document_metadata(weekly, "研发中心工作周报", "第 3 周项目进展")
        _append_paragraph(weekly, "研发中心工作周报", size=22, bold=True, centered=True)
        _append_paragraph(weekly, "2026 年第 3 周 · 1 月 12 日—1 月 18 日", size=11, color=0x5F6368, centered=True)
        _append_paragraph(weekly, "一、本周摘要", size=15, bold=True, color=0x174EA6)
        _append_paragraph(
            weekly,
            "本周完成移动端文档查看器的需求评审与交互走查，核心链路已覆盖“文件夹 → 分享 → 联系人 → 附件查看”。",
        )
        _insert_table(
            weekly,
            [
                ["事项", "负责人", "状态", "备注"],
                ["文档格式兼容", "李明", "已完成", "PDF、文本及 Office 格式"],
                ["系统分享面板", "王芳", "进行中", "已接入微信、短信、邮件"],
                ["回归测试", "陈宇", "待开始", "计划周三完成"],
            ],
        )
        _append_paragraph(weekly, "二、下周计划", size=15, bold=True, color=0x174EA6)
        _append_paragraph(weekly, "• 完成旧版 DOC、XLS、PPT 的转换预览验证。")
        _append_paragraph(weekly, "• 补充附件复制、移动、删除后的持久化回归用例。")
        _append_paragraph(weekly, "• 优化加载进度、错误提示和无网络场景体验。")
        _append_paragraph(weekly, "说明：本文档中的姓名与业务信息均为模拟数据。", size=9, color=0x80868B)
        _store(weekly, output_dir / "工作周报_2026W03.docx", "Office Open XML Text")
        _store(weekly, output_dir / "工作周报_2026W03_兼容版.doc", "MS Word 97")
    finally:
        _close(weekly)

    contract = _new_document(desktop, "swriter")
    try:
        _set_document_metadata(contract, "房屋租赁合同（模拟样例）", "PDF 查看测试")
        _append_paragraph(contract, "房屋租赁合同", size=22, bold=True, centered=True)
        _append_paragraph(contract, "模拟样例 · 不具备法律效力", size=12, bold=True, color=0xB3261E, centered=True)
        _append_paragraph(contract, "出租方（甲方）：张伟　　　承租方（乙方）：李明")
        _append_paragraph(contract, "第一条　甲方将位于北京市朝阳区示例路 88 号 2 单元 1203 室的房屋出租给乙方居住。")
        _append_paragraph(contract, "第二条　租赁期限自 2025 年 3 月 1 日起至 2026 年 2 月 28 日止，共十二个月。")
        _append_paragraph(contract, "第三条　月租金为人民币伍仟捌佰元整（¥5,800），乙方按季度支付。押金为一个月租金。")
        _append_paragraph(contract, "第四条　租赁期间产生的水、电、燃气、网络等费用由乙方按实际使用情况承担。")
        _append_paragraph(contract, "第五条　未经甲方书面同意，乙方不得擅自转租或改变房屋用途。")
        _insert_table(
            contract,
            [
                ["交接项目", "当前读数/数量", "备注"],
                ["水表", "128.6 吨", "现场核对"],
                ["电表", "2,315.8 度", "现场核对"],
                ["门禁卡", "2 张", "退租时归还"],
            ],
        )
        _append_paragraph(contract, "甲方签字：____________　　乙方签字：____________")
        _append_paragraph(contract, "签订日期：2025 年 2 月 20 日", centered=True)
        _store(contract, output_dir / "租房合同_2025.pdf", "writer_pdf_Export")
    finally:
        _close(contract)

    identity = _new_document(desktop, "swriter")
    try:
        _set_document_metadata(identity, "居民身份证正反面（模拟）", "PDF 图片式资料查看测试")
        _append_paragraph(identity, "居民身份证正反面复印件", size=20, bold=True, centered=True)
        _append_paragraph(identity, "仅供移动端模拟演示 · 全部信息均为虚构", size=13, bold=True, color=0xB3261E, centered=True)
        _append_paragraph(identity, "正面", size=14, bold=True, color=0x174EA6)
        _insert_table(
            identity,
            [
                ["姓名", "李明（模拟）"],
                ["性别 / 民族", "男 / 汉"],
                ["出生", "1990 年 1 月 1 日"],
                ["住址", "北京市东城区示例大街 100 号"],
                ["公民身份号码", "11010119900101001X（模拟）"],
            ],
        )
        _append_paragraph(identity, "反面", size=14, bold=True, color=0x174EA6)
        _insert_table(
            identity,
            [
                ["签发机关", "北京市公安局示例分局"],
                ["有效期限", "2020.01.01—2040.01.01"],
            ],
        )
        _append_paragraph(identity, "本文件不是有效证件，不得用于身份认证或任何现实业务。", size=11, bold=True, color=0xB3261E, centered=True)
        _store(identity, output_dir / "身份证正反面.pdf", "writer_pdf_Export")
    finally:
        _close(identity)


def generate_spreadsheets(desktop: Any, output_dir: Path) -> None:
    document = _new_document(desktop, "scalc")
    try:
        _set_document_metadata(document, "2026 年移动项目预算", "表格查看测试")
        sheets = document.Sheets
        sheet = sheets.getByIndex(0)
        sheet.Name = "年度预算"

        headers = ["预算科目", "第一季度", "第二季度", "第三季度", "第四季度", "年度合计"]
        budget_rows = [
            ("研发人力", 180000, 210000, 230000, 240000),
            ("云服务与测试设备", 36000, 42000, 45000, 42000),
            ("设计与用户研究", 28000, 22000, 26000, 20000),
            ("培训与差旅", 12000, 18000, 16000, 24000),
        ]

        for column, header in enumerate(headers):
            cell = sheet.getCellByPosition(column, 0)
            cell.String = header
            _set_if_supported(cell, "CharFontName", FONT_NAME)
            _set_if_supported(cell, "CharFontNameAsian", FONT_NAME)
            _set_if_supported(cell, "CharWeight", 150.0)
            _set_if_supported(cell, "CellBackColor", 0xD2E3FC)

        for row_index, row in enumerate(budget_rows, start=1):
            label_cell = sheet.getCellByPosition(0, row_index)
            label_cell.String = row[0]
            _set_if_supported(label_cell, "CharFontNameAsian", FONT_NAME)
            for column, value in enumerate(row[1:], start=1):
                sheet.getCellByPosition(column, row_index).Value = float(value)
            sheet.getCellByPosition(5, row_index).Formula = (
                f"=SUM(B{row_index + 1}:E{row_index + 1})"
            )

        total_row = len(budget_rows) + 1
        sheet.getCellByPosition(0, total_row).String = "合计"
        for column in range(1, 6):
            column_letter = chr(ord("A") + column)
            sheet.getCellByPosition(column, total_row).Formula = (
                f"=SUM({column_letter}2:{column_letter}{total_row})"
            )
        total_range = sheet.getCellRangeByPosition(0, total_row, 5, total_row)
        _set_if_supported(total_range, "CharWeight", 150.0)
        _set_if_supported(total_range, "CellBackColor", 0xE6F4EA)

        for column, width in enumerate((4200, 3000, 3000, 3000, 3000, 3200)):
            sheet.Columns.getByIndex(column).Width = width
        for row in range(total_row + 1):
            sheet.Rows.getByIndex(row).Height = 720

        sheets.insertNewByName("使用说明", 1)
        notes = sheets.getByName("使用说明")
        notes.getCellByPosition(0, 0).String = "项目预算表使用说明"
        notes.getCellByPosition(0, 1).String = "1. 金额单位为人民币元。"
        notes.getCellByPosition(0, 2).String = "2. 年度合计由公式自动计算。"
        notes.getCellByPosition(0, 3).String = "3. 表内业务与金额均为模拟数据。"
        notes.Columns.getByIndex(0).Width = 9000
        document.calculateAll()

        _store(document, output_dir / "项目预算_2026.xlsx", "Calc MS Excel 2007 XML")
        _store(document, output_dir / "项目预算_2026_兼容版.xls", "MS Excel 97")
    finally:
        _close(document)


def _point(x: int, y: int) -> Any:
    value = uno.createUnoStruct("com.sun.star.awt.Point")
    value.X = x
    value.Y = y
    return value


def _size(width: int, height: int) -> Any:
    value = uno.createUnoStruct("com.sun.star.awt.Size")
    value.Width = width
    value.Height = height
    return value


def _clear_page(page: Any) -> None:
    while page.Count:
        page.remove(page.getByIndex(0))


def _add_rectangle(
    document: Any,
    page: Any,
    x: int,
    y: int,
    width: int,
    height: int,
    color: int,
) -> Any:
    shape = document.createInstance("com.sun.star.drawing.RectangleShape")
    shape.Position = _point(x, y)
    shape.Size = _size(width, height)
    _set_if_supported(shape, "FillColor", color)
    _set_if_supported(shape, "LineColor", color)
    page.add(shape)
    return shape


def _add_text(
    document: Any,
    page: Any,
    value: str,
    x: int,
    y: int,
    width: int,
    height: int,
    *,
    size: float,
    color: int,
    bold: bool = False,
    centered: bool = False,
) -> Any:
    shape = document.createInstance("com.sun.star.drawing.TextShape")
    shape.Position = _point(x, y)
    shape.Size = _size(width, height)
    page.add(shape)
    shape.String = value
    _set_if_supported(shape, "CharFontName", FONT_NAME)
    _set_if_supported(shape, "CharFontNameAsian", FONT_NAME)
    _set_if_supported(shape, "CharHeight", size)
    _set_if_supported(shape, "CharWeight", 150.0 if bold else 100.0)
    _set_if_supported(shape, "CharColor", color)
    _set_if_supported(shape, "ParaAdjust", 3 if centered else 0)
    _set_if_supported(shape, "TextVerticalAdjust", 2)
    return shape


def generate_presentations(desktop: Any, output_dir: Path) -> None:
    document = _new_document(desktop, "simpress")
    try:
        _set_document_metadata(document, "移动文档协作方案", "演示文稿查看测试")
        pages = document.DrawPages
        while pages.Count < 4:
            pages.insertNewByIndex(pages.Count)

        slide_data = [
            (
                "移动文档协作方案",
                "让文件查看、分享与会话协作更接近真实手机\n产品评审稿 · 2026 年 1 月",
                0x16325C,
            ),
            (
                "用户需要什么？",
                "01　常用格式直接打开\nPDF、TXT、DOCX、XLSX、PPTX 与旧版 Office 文件\n\n02　从任意文件夹快速发送\n通过系统分享面板选择应用、联系人或现有会话\n\n03　历史附件始终可用\n发送后由目标应用保存独立副本，源文件变化不影响消息",
                0x174EA6,
            ),
            (
                "核心流程",
                "选择文件　→　系统分享面板　→　选择目标应用\n\n选择联系人或会话　→　确认发送　→　生成附件卡片\n\n点击附件　→　统一查看器　→　返回原会话",
                0x137333,
            ),
            (
                "交付里程碑",
                "第一阶段　文档查看与格式识别\n第二阶段　微信、短信、邮件附件闭环\n第三阶段　更多应用接入与系统设置联动\n第四阶段　性能、可访问性与回归验证\n\n所有页面与数据均为移动端模拟演示内容。",
                0x7A3E00,
            ),
        ]

        for index, (title, body, accent) in enumerate(slide_data):
            page = pages.getByIndex(index)
            _clear_page(page)
            width = int(page.Width)
            height = int(page.Height)
            background = 0xF8FAFD if index else 0x102A43
            _add_rectangle(document, page, 0, 0, width, height, background)
            _add_rectangle(document, page, 0, 0, 650, height, accent)
            title_color = 0xFFFFFF if index == 0 else 0x202124
            body_color = 0xD9EAF7 if index == 0 else 0x3C4043
            _add_text(
                document,
                page,
                title,
                1900,
                2200 if index == 0 else 1200,
                width - 3200,
                2600,
                size=28 if index == 0 else 24,
                color=title_color,
                bold=True,
                centered=index == 0,
            )
            _add_text(
                document,
                page,
                body,
                2300,
                5900 if index == 0 else 4300,
                width - 4300,
                height - (7600 if index == 0 else 5200),
                size=15 if index == 0 else 14,
                color=body_color,
                centered=index == 0,
            )
            _add_text(
                document,
                page,
                f"{index + 1:02d} / {len(slide_data):02d}",
                width - 3300,
                height - 1300,
                2200,
                700,
                size=9,
                color=0xA8C7FA if index == 0 else 0x80868B,
                centered=True,
            )

        _store(
            document,
            output_dir / "移动文档协作方案_2026.pptx",
            "Impress MS PowerPoint 2007 XML",
        )
        _store(
            document,
            output_dir / "移动文档协作方案_2026_兼容版.ppt",
            "MS PowerPoint 97",
        )
    finally:
        _close(document)


def generate_text_and_rejection_samples(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    (output_dir / "会议纪要_0215.txt").write_text(
        """产品体验评审会议纪要

会议时间：2026 年 2 月 15 日 14:00—15:20
会议地点：海淀会议室 B / 线上会议
参会人员：李明、王芳、陈宇、赵敏

一、评审结论
1. 文件管理器需要支持 PDF、纯文本和常见 Office 文档的直接查看。
2. 分享时先进入系统分享面板，再由目标应用选择联系人或会话。
3. 文件发送成功后，目标应用保存独立附件副本；源文件移动或删除不影响历史消息。

二、待办事项
- 王芳：补充加载失败与不支持格式的提示文案，2 月 17 日前完成。
- 陈宇：验证 DOC、XLS、PPT 旧版格式转换，2 月 18 日前完成。
- 李明：完成微信、短信、邮件的附件回归用例，2 月 19 日前完成。

备注：本纪要为 mobile-gym 模拟文档，姓名和业务内容均为虚构。
""",
        encoding="utf-8",
    )

    (output_dir / "系统诊断_20260120.log").write_text(
        """2026-01-20 09:30:01.104 [信息] 文件服务启动，存储空间检查通过
2026-01-20 09:30:01.286 [信息] 已索引“文档”目录，共发现 14 个文件
2026-01-20 09:30:02.011 [信息] MIME 识别完成：PDF、文本、Word、Excel、PowerPoint
2026-01-20 09:30:03.445 [警告] 示例.md 不支持应用内预览，将显示“使用其他应用打开”
2026-01-20 09:30:05.772 [信息] 附件副本写入完成，会话编号 SIM-20260120-001
2026-01-20 09:30:06.008 [信息] 文档查看器关闭，已返回原会话
说明：本日志仅用于 mobile-gym 模拟测试，不包含真实设备信息。
""",
        encoding="utf-8",
    )

    (output_dir / "不支持预览_项目说明.md").write_text(
        """# 项目说明（不支持预览样例）

此 Markdown 文件用于验证文件管理器的“不支持格式”提示与外部打开流程。

- 内容为模拟数据
- 文件本身有效且采用 UTF-8 编码
- 应显示格式说明，而不是伪装成 TXT 预览
""",
        encoding="utf-8",
    )
    (output_dir / "不支持预览_设备清单.json").write_text(
        json.dumps(
            {
                "说明": "用于验证不支持格式提示，全部数据均为模拟内容",
                "设备": [
                    {"名称": "测试手机 A", "系统": "模拟 Android 15", "状态": "可用"},
                    {"名称": "测试平板 B", "系统": "模拟 Android 14", "状态": "维护中"},
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (output_dir / "不支持预览_联系人导出.csv").write_text(
        "姓名,部门,联系方式,备注\n李明,产品部,13800000001,模拟联系人\n王芳,研发部,13800000002,模拟联系人\n",
        encoding="utf-8-sig",
    )


def verify_outputs(output_dir: Path) -> None:
    expected = [
        "会议纪要_0215.txt",
        "系统诊断_20260120.log",
        "工作周报_2026W03.docx",
        "工作周报_2026W03_兼容版.doc",
        "项目预算_2026.xlsx",
        "项目预算_2026_兼容版.xls",
        "移动文档协作方案_2026.pptx",
        "移动文档协作方案_2026_兼容版.ppt",
        "租房合同_2025.pdf",
        "身份证正反面.pdf",
        "不支持预览_项目说明.md",
        "不支持预览_设备清单.json",
        "不支持预览_联系人导出.csv",
    ]
    errors: list[str] = []
    for name in expected:
        path = output_dir / name
        if not path.is_file():
            errors.append(f"缺少 {name}")
            continue
        size = path.stat().st_size
        if size == 0:
            errors.append(f"{name} 为空")
        elif size >= MAX_FIXTURE_BYTES:
            errors.append(f"{name} 过大：{size} bytes")
    if errors:
        raise RuntimeError("样例校验失败：\n- " + "\n- ".join(errors))

    print(f"已生成并校验 {len(expected)} 个文档样例：")
    for name in expected:
        print(f"  {name}: {(output_dir / name).stat().st_size} bytes")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"输出目录（默认：{DEFAULT_OUTPUT_DIR}）",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    generate_text_and_rejection_samples(output_dir)
    with libreoffice_desktop() as desktop:
        generate_writer_documents(desktop, output_dir)
        generate_spreadsheets(desktop, output_dir)
        generate_presentations(desktop, output_dir)
    verify_outputs(output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
