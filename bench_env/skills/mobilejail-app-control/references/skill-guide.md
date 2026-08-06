# MobileJail 技能指南

所有 App 的语义 API 方法、Store 操作和模块函数的完整参考。本文件仅供人工阅读，不影响 Agent 执行。

---

## 技能层工作原理

每个 App 可以通过三种调度机制进行操作：

| 调度方式 | Python 方法 | JS 执行路径 | 适用场景 |
|---|---|---|---|
| **Store action** | `app.call("camelCase", ...)` | `__BENCH_STORES__.get(appId).getState()[action](...)` | Zustand store 中注册的变更操作 |
| **Module function** | `app.module("/path/to/module.ts", "exportName", ...)` | `await import(modulePath); module[fn](...)` | 不在 store 中的 Provider/OS 函数 |
| **UI function** | `app.ui("action-or-trigger-id")` | 点击匹配 `data-action`/`data-trigger` 的 DOM 元素 | React 局部状态、导航触发器 |

**语义方法**（如 `phone.sms.send(...)`）是更高级的封装，它们：
1. 将用户可读名称解析为内部标识（联系人名 → ID，文件路径 → ref）
2. 组合多个底层调用（如 Mail 发送 = `createDraft` + `sendMessage`）
3. 校验业务前置条件（支付密码、余额等）

**动态调度**（`app.some_snake_case(...)`）自动将 `snake_case` 转为 `camelCase`，先尝试 store action，再尝试 UI function。它**不会**尝试 module function —— 那些需要显式的语义封装或 `app.module(...)`。

**电话号码自动检测**：在 `sms.send()` 中，如果 `to` 参数看起来像电话号码（匹配 `^[\+]\d[\d\s]{6,}$` 或 `^\d{7,}$`），会自动将其移至 `phone` 参数。

---

## 通用方法（所有 App 共有）

```python
await phone.<app>.open()                    # 打开 App，返回当前活跃路由
state = await phone.<app>.state()           # App 友好的状态视图（合并 provider 数据）
actions = await phone.<app>.functions()     # 列出可用的 store actions（camelCase）
ui_ids = await phone.<app>.ui_functions()  # 列出当前挂载的 data-action/data-trigger ID
mapping = await phone.<app>.available_functions()  # Python 名称 → 真实 store/UI ID 的映射
route = await phone.<app>.route("/path")   # 在指定的声明路由上打开 App

# 底层调度
result = await phone.<app>.call("camelCase", ...)   # Store action
result = await phone.<app>.ui("actionOrTriggerId")  # UI function（无参数）
result = await phone.<app>.module("/path.ts", "func", ...)  # Module function
```

所有变更方法返回 `CallResult`：
- `result.changed` — App/OS 状态是否发生变化，`True` 表示已变化
- `result.changed_paths` — 叶子级差异路径的元组
- `result.value` — 函数的返回值
- `result.require_changed()` — 若无状态变化则抛出 `SkillError`

---

## 支付宝 `phone.alipay`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `transfer` | `transfer(contact, amount, note="", password="", method_id="balance")` | 转账。校验支付密码和余额。`method_id` 可为 `"balance"` 或银行卡 ID。 |
| `send_text` | `send_text(contact, text)` | 发送聊天消息。自动将联系人名解析为会话 ID。 |

### Store actions

`addBankCard`, `addBillSearchHistory`, `bindBankCard`, `clearBillSearchHistory`, `computeUnread`, `deductBalance`, `markAllConversationsRead`, `markConversationRead`, `recordTransfer`, `redeemRechargeCard`, `sendChatMessage`, `sendImages`, `sendSharedFiles`, `setLanguage`, `setLastPaymentHint`, `setPaymentPassword`, `setSettings`, `setTransferDraft`, `setTransferReceipt`, `unbindBankCard`, `updateTransferRecord`, `upsertSubscription`

---

## B站 `phone.bilibili`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `comment` | `comment(video_id, text)` | 在视频下添加评论（按视频 ID）。 |
| `comment_first` | `comment_first(text)` | 对当前活跃/第一个视频评论（自动解析视频 ID）。 |
| `send_files` | `send_files(recipient, paths)` | 向B站用户发送文件。从关注/粉丝/聊天中解析收件人名称 → 用户 ID。 |

### Store actions

`addCoin`, `addComment`, `addReply`, `addSearchHistory`, `clearSearchHistory`, `createFavFolder`, `publishDynamic`, `sendDanmaku`, `sendImageMessage`, `sendMessage`, `sendSharedFiles`, `sendVideoMessage`, `setActiveVideoId`, `setFavFolders`, `setSetting`, `shareVideo`, `toggleAnime`, `toggleDanmakuVisible`, `toggleDislike`, `toggleDrama`, `toggleFav`, `toggleFollow`, `toggleLike`, `tripleAction`, `updateUser`

---

## 浏览器 `phone.browser`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `search` | `search(query)` | 将当前活跃标签页导航至 Google 搜索。同时记录访问 URL。 |

### Store actions

`addTab`, `closeTab`, `goHome`, `navigateTab`, `setActiveTabId`, `trackVisitedUrl`

---

## 日历 `phone.calendar`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `create` | `create(title, description="", *, start_ts=None, end_ts=None, all_day=False)` | 创建日历事件。默认：开始=当前时间，结束=开始+1小时。 |

### Store actions

`createEvent`, `deleteEvent`, `setSelectedDate`, `updateEvent`, `updateSettings`

---

## 通讯录 `phone.contacts`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `create` | `create(values: dict)` | 创建联系人。传入包含 `name`、`phone`、`email`、`notes` 等键的字典。使用 module_call。 |
| `update` | `update(contact_id, values: dict)` | 按 ID 更新联系人。使用 module_call。 |
| `delete` | `delete(contact_id)` | 按 ID 删除联系人。使用 module_call。 |
| `update_by_name` | `update_by_name(name, values: dict)` | 按显示名查找联系人并更新。在 provider 数据中模糊匹配名称。 |

### Store actions

`addCallLog`, `addSearchHistory`, `clearSearchHistory`, `createContact`, `deleteContact`, `recordLastContacted`, `removeSearchHistoryItem`, `toggleStarred`, `updateContact`, `updateSettings`, `useBooleanPreference`, `useContact`, `useContactsList`, `useStarredContacts`, `useStringPreference`

### 模块路径

`/system/Contacts/state.ts` — `createContact`、`updateContact`、`deleteContact` 通过 module_call 访问。

---

## Ebay `phone.ebay`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `search` | `search(query, *, save_first=False)` | 搜索商品。可选自动收藏第一个搜索结果。 |
| `login_saved_account` | `login_saved_account(username=None, password=None)` | 使用已保存的账号登录。省略 username 则使用第一个保存的账号。 |

### Store actions

`addRecentSearch`, `clearRecentSearches`, `login`, `logout`, `recordSearchSnapshot`, `setSearchCurrent`, `toggleSaveItem`, `updateSettings`

---

## 文件管理器 `phone.file_manager`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `delete` | `delete(path)` | 按路径删除文件或目录。文件不存在时抛出异常。 |
| `move` | `move(source, destination)` | 移动文件。使用 `__SIM_FS__.move`。 |
| `copy_file` | `copy_file(source, destination)` | 复制文件。使用 `__SIM_FS__.copy`。 |
| `info` | `info(path) → dict` | 获取文件元数据（stat）。返回包含 `name`、`size`、`mimeType` 等的字典。 |
| `search` | `search(query) → list[dict]` | 按名称搜索文件。返回匹配的文件记录列表。 |

### Store actions

`clearClipboard`, `copy`, `cut`, `paste`

### 模块路径

`/os/FileSystemService.ts` — 所有语义方法均直接使用 `__SIM_FS__` 调用。

---

## 图库 `phone.gallery`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `photos` | `photos() → list[dict]` | 列出所有照片记录，来自 `__SIM_FS__.getMedia("image")`。 |
| `first_photo` | `first_photo(name=None) → str` | 获取第一张照片的路径，或按名称查找。返回照片路径/ID。 |
| `share` | `share(photo_id, target_app=None, recipient=None, *, text="", subject="", body="")` | 将照片分享到其他 App。支持的目标：`"mail"`、`"sms"`、`"wechat"`、`"bilibili"`。省略 `target_app` 则触发系统分享 Intent（`shareImagesAsIntent`）。 |

### Store actions

无（图库未注册 store actions）。

### 模块路径

`/system/Gallery/shareImages.ts` — `shareImagesAsIntent`

### 分享目标详情

| 目标 | 必需参数 | 行为 |
|---|---|---|
| `"mail"` | `recipient`（邮箱），可选 `subject`、`body` | 调用 `phone.mail.send()` |
| `"sms"` | `recipient`（联系人名），可选 `text` | 调用 `phone.sms.send()` |
| `"wechat"` | `recipient`（联系人名） | 调用 `phone.wechat.send_files()` |
| `"bilibili"` | `recipient`（用户名） | 调用 `phone.bilibili.send_files()` |
| 无 / 省略 | — | 触发 Android 系统分享 Intent |

---

## 邮箱 `phone.mail`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `send` | `send(to, subject, body, attachments=None)` | 发送邮件。`to` 可为字符串或列表。附件自动从文件路径解析为 file ref。内部流程：`createDraft` → `sendMessage`。 |
| `forward` | `forward(subject, to)` | 按主题关键词查找邮件并转发。保留原始附件。 |
| `get_message` | `get_message(message_id) → dict or None` | 按 ID 读取邮件。使用 **module_call**（非 store action）。 |
| `list_messages` | `list_messages(folder="inbox") → list[dict]` | 列出文件夹中的邮件。使用 **module_call**。 |
| `find_message_by_subject` | `find_message_by_subject(subject) → dict or None` | 按主题关键词搜索收件箱邮件（模糊匹配）。搜索 mail provider 数据。 |

### Store actions

`addAttachment`, `clearTimers`, `createDraft`, `deleteMessageForever`, `extractEmailAddress`, `getAccount`, `getAttachments`, `getMessage`, `getUnreadCount`, `invalidateMailSnapshot`, `isValidEmail`, `listMessagesByFolder`, `markFolderRead`, `markRead`, `markUnread`, `moveToTrash`, `pickAvatarColor`, `removeAttachment`, `restoreFromTrash`, `saveDraft`, `sendMessage`, `toggleStar`, `trackTimer`, `untrackTimer`, `updateSettings`, `useMailProviderState`

> **重要**：`getMessage` 和 `listMessagesByFolder` 被列为 store actions，但实际上是**模块导出函数**。请使用语义方法 `get_message()` / `list_messages()`，不要使用 `call("getMessage", ...)`。

### 模块路径

`/apps/Mail/state.ts` — `createDraft`、`sendMessage`、`getMessage`、`listMessagesByFolder`

---

## 地图 `phone.map`

### 语义方法

除通用 `open()`、`state()` 等外无额外语义方法。

### Store actions

`addSearchHistory`, `clearCurrentView`, `clearSearchHistory`, `refreshLocation`, `setActivePoi`, `setActiveRoute`, `setAllRecNotifications`, `setAllTrafficNotifications`, `setAutocomplete`, `setGoogleLoadError`, `setGoogleLoaded`, `setPlaceResultsSheetOpen`, `setRouteModes`, `setRouteSetupOpen`, `setRouteSheetOpen`, `setSearchResults`

---

## 便签 `phone.notes`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `create` | `create(title, content)` | 创建新便签，包含标题和内容。 |

### Store actions

`addFolder`, `addNote`, `addTodo`, `deleteFolder`, `deleteNote`, `deleteNoteForever`, `deleteTodo`, `hideNote`, `renameFolder`, `restoreNote`, `setSelectedFolderId`, `toggleTodo`, `unhideNote`, `updateNote`, `updateSettings`, `updateTodoText`

---

## 铁路 12306 `phone.railway12306`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `search` | `search(origin, destination, date=None)` | 查询火车票。设置出发/到达站和可选日期，然后执行查询。 |

### Store actions

`addInvoiceHeader`, `addOrder`, `addSearchHistory`, `changePassword`, `executeQuery`, `executeTransferQuery`, `login`, `logout`, `markNotificationRead`, `maskEmail`, `maskIdNo`, `maskName`, `maskPhone`, `registerAccount`, `requestResetCode`, `resetPassword`, `resetPasswordWithCode`, `setDate`, `setFrom`, `setInvoiceEmail`, `setIsStudent`, `setSelectedTrain`, `setStationSelectTarget`, `setTo`, `swapStations`, `updateOrder`, `updateOrderTickets`, `updatePassengers`, `updateSettings`

---

## 小红书 `phone.redbook`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `publish` | `publish(title, content, images=None)` | 发布新笔记，包含标题、内容和可选图片路径。 |
| `comment` | `comment(note_id, text, image=None)` | 在笔记下添加评论（按笔记 ID），可选附带图片。 |
| `comment_latest` | `comment_latest(author, text, image=None)` | 查找某作者的最新笔记并评论。搜索用户和聊天来解析作者 ID，然后找到其最近的笔记。 |

### Store actions

`addComment`, `addNote`, `addSearchHistory`, `addToHistory`, `clearCache`, `clearHistory`, `clearSearchHistory`, `followUser`, `logout`, `markNotificationsAsRead`, `removeSearchHistory`, `resetPublishDraft`, `sendImageMessage`, `sendMessage`, `sendNoteMessage`, `sendSharedFiles`, `toggleCollect`, `toggleCommentLike`, `toggleLike`, `updateHomeState`, `updatePublishDraft`, `updateSettings`, `updateUser`

---

## Reddit `phone.reddit`

### 语义方法

除通用方法外无额外语义方法。

### Store actions

`addComment`, `addFlair`, `addReplyComment`, `createPost`, `deleteChatMessage`, `deleteOwnComment`, `deleteOwnPost`, `editComment`, `resetCreateDraft`, `saveProfile`, `seedChatThread`, `selectCommunity`, `sendChatImage`, `sendChatMessage`, `sendChatReply`, `sharePost`, `toggleJoin`, `toggleJoinCommunity`, `toggleSave`, `trimUserComments`, `updateOwnPost`, `updateSettings`, `voteComment`, `votePost`

---

## 设置 `phone.settings`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `set` | `set(path, value)` | 设置偏好项。使用 **module_call**（`routeSetPreference`）。会校验 key 是否被识别——若偏好路径无效则抛出 `SkillError` 并提示可用的 key。 |
| `get` | `get(path) → Any` | 获取偏好值。使用 **module_call**（`routeGetPreference`）。未知 key 返回 `None`。 |
| `enable_developer_mode` | `enable_developer_mode(enabled=True)` | 快捷方式：调用 `set("enable_development_settings", enabled)`。 |

### 已知的偏好键

`enable_development_settings`, `usb_debugging`, `wifi_enabled`, `bluetooth_enabled`, `airplane_mode`, `dark_mode`, `night_mode`, `auto_rotate`, `location_enabled`, `nfc_enabled`, `hotspot_enabled`, `dnd_enabled`（以及更多——`routeSetPreference` 接受的键取决于 `os/managers/registry.ts`）

### Store actions

`addWifiSavedNetwork`, `connectWifi`, `forgetWifiSavedNetwork`, `getPreferenceValue`, `initPagesData`, `setPreferenceValue`, `setWifiNetworkAutoJoin`, `useBooleanPreference`, `useNumberPreference`, `useStringPreference`, `useWifiActions`, `useWifiConnectedSsid`, `useWifiSavedNetworks`

### 模块路径

`/os/managers/registry.ts` — `routeSetPreference`、`routeGetPreference`

---

## 短信 `phone.sms`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `send` | `send(to, text, phone=None, attachments=None)` | 发送短信。按名称或电话号码解析会话。电话号码自动检测：若 `to` 看起来像电话号码，自动移至 `phone` 参数。内部流程：`ensureConversation` → `sendMessage`，若有附件则再调用 `sendSharedAttachments`。 |

### Store actions

`clearTimers`, `commitOutgoingShare`, `consumePendingNewMessageFiles`, `deleteConversation`, `ensureConversation`, `getUnreadCount`, `isValidPhoneNumber`, `markAllRead`, `markConversationRead`, `markConversationUnread`, `pinConversation`, `sendFile`, `sendImage`, `sendMessage`, `sendSharedAttachments`, `setPendingNewMessageFiles`, `trackTimer`, `untrackTimer`, `updateSettings`, `useSmsProviderState`

### 模块路径

`/system/Sms/state.ts` — `ensureConversation`、`sendMessage`、`sendSharedAttachments`

---

## Spotify `phone.spotify`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `create_playlist` | `create_playlist(name)` | 创建新播放列表。 |

### Store actions

`addAccount`, `addToQueue`, `addTrackToPlaylist`, `clearLikedToast`, `clearQueueToast`, `createPlaylist`, `playTrack`, `removeTrackFromPlaylist`, `setAlbumAvgDuration`, `setAlbumInfo`, `setArtistKeywordCount`, `setArtistPopularTracks`, `setArtistTopAlbum`, `setQueueWithTracks`, `setSearchResults`, `showQueueToast`, `skipToNext`, `skipToPrevious`, `switchAccount`, `toggleFollowArtist`, `toggleLike`, `togglePlay`, `toggleRepeat`, `toggleShuffle`, `updateTrackCover`

---

## 腾讯会议 `phone.tencent_meeting`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `join` | `join(host_or_title)` | 按主持人姓名、会议标题或会议 ID 加入会议。搜索进行中、常规和预定的会议。加入时默认关闭麦克风/摄像头。 |

### Store actions

`addContact`, `addHistory`, `cancelScheduledMeeting`, `endMeeting`, `markMessageRead`, `muteAllParticipants`, `scheduleMeeting`, `sendChatFiles`, `sendChatImage`, `sendChatMessage`, `setCurrentScheduledMeeting`, `setPendingMeetingConfig`, `startMeeting`, `updateMeetingSettings`, `updateParticipant`, `updatePersonalRoom`, `updateScheduledMeeting`, `updateSettings`

---

## 微信 `phone.wechat`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `resolve_contact` | `resolve_contact(contact) → str` | 将联系人名/别名/电话解析为 wxid。按 `wxid`、`id`、`name`、`alias`、`phone` 搜索联系人。 |
| `send_text` | `send_text(contact, text)` | 发送文本消息。解析联系人 → wxid，然后调用 `sendMessage`。 |
| `send_files` | `send_files(contact, paths)` | 向联系人发送文件。解析联系人 → wxid 和文件路径 → file ref。调用 `sendSharedAttachments`。 |

### Store actions

`addAddress`, `addInvoice`, `addSubscription`, `cancelAccount`, `clearMomentDraft`, `clearTextMomentDraft`, `deauthorizeApp`, `dismissLoginExpiredModal`, `loginWithCode`, `loginWithPassword`, `logout`, `postMoment`, `receiveTransfer`, `registerAccount`, `requestVerificationCode`, `resetPassword`, `sendFiles`, `sendImages`, `sendLinkMessage`, `sendMessage`, `sendPat`, `sendSharedAttachments`, `sendSharedAttachmentsToTargets`, `setRightAction`, `transferMoney`, `trustCurrentDevice`, `updateChatSettings`, `updateContactState`, `updateMomentDraft`, `updateSettings`, `updateSubscription`, `updateTextMomentDraft`, `updateUser`

---

## 微信读书 `phone.wechat_reading`

### 语义方法

除通用方法外无额外语义方法。

### Store actions

`addBooksToLikedList`, `addReadingRecord`, `addToBookshelf`, `refreshRecommendedAudiobooks`, `removeBookFromLikedList`, `removeFromShelf`, `setAudioSubTab`, `toggleFollow`, `toggleLikedListSyncToHome`, `togglePrivate`, `updateLikedListRecommendation`, `updateNotifications`, `updatePrivacy`, `updateProfilePrivacy`, `updateProgress`, `updateReaderPrefs`, `updateSettings`, `updateUserProfile`

---

## X (推特) `phone.x`

### 语义方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `publish` | `publish(text, images=None)` | 发帖。可选附带图片路径。 |

### Store actions

`_loadData`, `addPost`, `addReply`, `ensureConversationForUser`, `ensureRepliesLoaded`, `sendImageMessage`, `sendMessage`, `sendPostMessage`, `sendSharedFiles`, `sendSharedFilesToRecipient`, `setPendingQuotedPostId`, `setSearchQuery`, `toggleBookmark`, `toggleFollow`, `toggleLike`, `toggleRetweet`, `updateSettings`, `updateUser`

---

## 答题卡 `phone.answer_sheet`

### 语义方法

除通用方法外无额外语义方法。

### Store actions

`addRepeatableItem`, `removeRepeatableItem`, `setAnswer`, `submit`, `unsubmit`, `updateRepeatableItem`

---

## 计算器 `phone.calculator`

无 store actions。纯 UI 交互 App。

## 科学计算器 `phone.calculator2`

### Store actions

`inputConstant`, `inputDecimal`, `inputDigit`, `inputFunction`, `inputOperator`, `inputParen`, `onClear`, `onDelete`, `onEvaluate`, `setAnimCallbacks`

## 时钟 `phone.clock`

### Store actions

`addCity`, `deleteAlarms`, `removeCities`, `saveAlarm`, `setAlarms`, `setSelectedCityIds`, `toggleAlarm`

## 指南针 `phone.compass`

### Store actions

`fetchLocation`, `setHeading`, `setLevelAngle`

## 主题商店 `phone.theme_store`

无 store actions。纯 UI 交互 App。

## 天气 `phone.weather`

无 store actions。纯 UI 交互 App。

---

## 各 App 模块路径汇总

使用 `module_call` 进行部分或全部操作的 App：

| App | 模块路径 | 通过 module 访问的函数 |
|---|---|---|
| 通讯录 | `/system/Contacts/state.ts` | `createContact`, `updateContact`, `deleteContact` |
| 文件管理器 | `/os/FileSystemService.ts` | 直接使用 `__SIM_FS__`（`stat`, `delete`, `move`, `copy`, `search`, `getMedia`） |
| 图库 | `/system/Gallery/shareImages.ts` | `shareImagesAsIntent` |
| 邮箱 | `/apps/Mail/state.ts` | `createDraft`, `sendMessage`, `getMessage`, `listMessagesByFolder` |
| 设置 | `/os/managers/registry.ts` | `routeSetPreference`, `routeGetPreference` |
| 短信 | `/system/Sms/state.ts` | `ensureConversation`, `sendMessage`, `sendSharedAttachments` |

内部还使用：`/os/FileShareService.ts` — `createFileRef`（由 `Runtime.file_ref()` 用于在传入 store actions 前解析文件路径）。

---

## 按场景分类的示例

### 通信与消息

```python
# 短信
await phone.sms.send("张三", "你好", phone="+86 13800138000")
await phone.sms.send("+86 13800138000", "你好")  # 电话号码从 `to` 自动检测
await phone.sms.send("张三", "请查收", attachments="/sdcard/Download/a.pdf")

# 微信
await phone.wechat.send_text("Boss", "项目已完成")
await phone.wechat.send_files("Boss", "/sdcard/Download/周报.pdf")

# 支付宝聊天
await phone.alipay.send_text("老王", "下周评审见")
await phone.alipay.transfer("老王", 100, "测试", password="123456")

# 邮箱
await phone.mail.send("a@example.com", "主题", "正文", attachments=["/sdcard/Download/a.pdf"])
await phone.mail.forward("紧急沟通", "a@example.com")
msg = await phone.mail.get_message("message_id")
messages = await phone.mail.list_messages("inbox")
msg = await phone.mail.find_message_by_subject("系统设置要求")
```

### 社交与发布

```python
# X
await phone.x.publish("正文", ["/sdcard/DCIM/Camera/a.jpg"])

# 小红书
await phone.redbook.publish("标题", "正文", ["/sdcard/DCIM/Camera/a.jpg"])
await phone.redbook.comment("note-id", "评论", image="/sdcard/DCIM/Camera/a.jpg")
await phone.redbook.comment_latest("海边小橘子", "评论")

# B站
await phone.bilibili.comment_first("评论")
await phone.bilibili.send_files("佛山无影脚", "/sdcard/Download/evidence.png")
```

### 系统、文件与跨 App 分享

```python
# 设置
await phone.settings.enable_developer_mode(True)
await phone.settings.set("usb_debugging", True)
value = await phone.settings.get("enable_development_settings")

# 通讯录
await phone.contacts.update_by_name("周凯", {"notes": "评审对接人"})

# 文件管理器
await phone.file_manager.delete("/sdcard/Download/a.pdf")
node = await phone.file_manager.info("/sdcard/Download/a.pdf")
files = await phone.file_manager.search("a.pdf")

# 图库分享
photo = await phone.gallery.first_photo("风景.jpg")
await phone.gallery.share(photo, "mail", "a@example.com", subject="风景分享")
await phone.gallery.share(photo, "sms", "王海峰", text="风景.jpg")
await phone.gallery.share(photo, "wechat", "好友")
```

### 效率、搜索与媒体

```python
# 便签
await phone.notes.create("标题", "正文")

# 日历
await phone.calendar.create("周会", "评审排期与下周任务分配")

# 浏览器
await phone.browser.search("分布式系统学习路线")

# Ebay
await phone.ebay.search("Apple 手机", save_first=True)
await phone.ebay.login_saved_account("zhangwei")

# 铁路 12306
await phone.railway12306.search("北京", "上海")

# Spotify
await phone.spotify.create_playlist("2026 通勤歌单")

# 腾讯会议
await phone.tencent_meeting.join("老王")
```