// Code-split by page (M15): the login screen and the installed app's first paint don't wait for the dashboard's
// charts. The service worker precaches every chunk, so this costs nothing offline or on a slow network after the
// first visit.
import { lazy } from "react"

export const App = lazy(() => import("../App.tsx"))
export const ConsentPage = lazy(() => import("./consent").then((m) => ({ default: m.ConsentPage })))
export const MembersPage = lazy(() => import("./members").then((m) => ({ default: m.MembersPage })))
export const LinkPage = lazy(() => import("./link").then((m) => ({ default: m.LinkPage })))
export const SettingsPage = lazy(() => import("./settings").then((m) => ({ default: m.SettingsPage })))
export const PrivacyPage = lazy(() => import("./legal").then((m) => ({ default: m.PrivacyPage })))
export const TermsPage = lazy(() => import("./legal").then((m) => ({ default: m.TermsPage })))
export const SecurityPage = lazy(() => import("./legal").then((m) => ({ default: m.SecurityPage })))
