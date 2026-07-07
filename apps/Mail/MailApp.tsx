import React, { useCallback, useContext, useEffect } from 'react';
import {
    MemoryRouter,
    Routes,
    Route,
    useLocation,
    useNavigate,
    UNSAFE_NavigationContext,
} from 'react-router-dom';
import { dimensToCssVars, themeToCssVars } from '../../os/utils/themeToCssVars';
import { applySkinToThemeColors } from '../../os/SkinService';
import { useDarkMode } from '../../os/hooks/useDarkMode';
import { useAppNavigationHandler } from '../../os/hooks/useAppNavigationHandler';
import { AppNavigatorRegistry } from '../../os/AppNavigatorRegistry';
import { useActivityContext } from '../../os/ActivityContext';
import { manifest } from './manifest';
import { colors, colorsDark } from './res/colors';
import { dimens } from './res/dimens';
import { FolderListPage } from './pages/FolderListPage';
import { FoldersPage } from './pages/FoldersPage';
import { MessageDetailPage } from './pages/MessageDetailPage';
import { ComposePage } from './pages/ComposePage';
import { useMailStore } from './state';
import { useAppNavigate } from './navigation';

const MailNavigationHandler: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { navigator } = useContext(UNSAFE_NavigationContext);
    const { activityId } = useActivityContext();
    const { back } = useAppNavigate();
    const mem = navigator as { index?: number; entries?: unknown[] };

    const handleBackPress = useCallback((): boolean => {
        if (location.pathname === '/') return false;
        if ((mem.index ?? 0) <= 0) return false;
        back();
        return true;
    }, [back, location.pathname, mem]);

    useEffect(() => {
        const navFn = (path: string, opts?: { replace?: boolean }) => {
            navigate(path, { replace: opts?.replace ?? true });
        };
        AppNavigatorRegistry.registerActivity(activityId, { navigate: navFn, back: handleBackPress }, 'mail');
        return () => {
            AppNavigatorRegistry.unregisterActivity(activityId);
        };
    }, [activityId, handleBackPress, navigate]);

    useAppNavigationHandler('mail', {
        onBack: handleBackPress,
        onNavigate: (path, navigateTo) => {
            const normalized =
                typeof path === 'string'
                    ? (path.startsWith('/') ? path : `/${path}`)
                    : null;
            if (!normalized) return;
            navigateTo(normalized);
        },
    });

    return null;
};

const MailApp: React.FC = () => {
    const { isDark } = useDarkMode();
    const themeColors = isDark
        ? { ...manifest.theme.colors, ...(manifest.theme.colorsDark ?? {}) }
        : manifest.theme.colors;
    const appColors = isDark ? { ...colors, ...colorsDark } : colors;
    const cssVars = {
        ...themeToCssVars(applySkinToThemeColors(themeColors)),
        ...dimensToCssVars(appColors, { prefix: '--app-c-' }),
        ...dimensToCssVars(dimens),
    };

    useEffect(() => {
        return () => {
            useMailStore.getState().clearTimers();
        };
    }, []);

    return (
        <div className="h-full w-full" style={cssVars as React.CSSProperties}>
            <MemoryRouter>
                <MailNavigationHandler />
                <div className="h-full w-full bg-app-bg">
                    <Routes>
                        <Route path="/" element={<FolderListPage />} />
                        <Route path="/folders" element={<FoldersPage />} />
                        <Route path="/message/:messageId" element={<MessageDetailPage />} />
                        <Route path="/compose" element={<ComposePage />} />
                        <Route path="/compose/:draftId" element={<ComposePage />} />
                    </Routes>
                </div>
            </MemoryRouter>
        </div>
    );
};

export default MailApp;
