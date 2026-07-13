import { Languages, Moon, Settings, Sun, type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../components/ui/sidebar"
import { Separator } from "../components/ui/separator"
import { navRoutes } from "./appRoutes"
import type { AppView, ThemeMode } from "./appStore"

type UpdateStatus = "idle" | "checking" | "available" | "current" | "error" | "updating" | "updated"

interface AppSidebarProps {
  appTitle: string
  activeView: AppView
  onNavigate: (view: AppView) => void
  isElectron: boolean
  updateStatus: UpdateStatus
  updateButtonTitle: string
  updateButtonLabel: string
  UpdateIcon: LucideIcon
  onUpdateClick: () => void
  theme: ThemeMode
  themeToggleLabel: string
  onToggleTheme: () => void
  languageTitle: string
  languageCode: string
  onToggleLanguage: () => void
}

export function AppSidebar({
  appTitle,
  activeView,
  onNavigate,
  isElectron,
  updateStatus,
  updateButtonTitle,
  updateButtonLabel,
  UpdateIcon,
  onUpdateClick,
  theme,
  themeToggleLabel,
  onToggleTheme,
  languageTitle,
  languageCode,
  onToggleLanguage,
}: AppSidebarProps) {
  const { t } = useTranslation()
  const ThemeIcon = theme === "dark" ? Sun : Moon

  return (
    <Sidebar collapsible="icon" mobileTitle={`${appTitle} ${t("app:mainNavigation")}`}>
      <SidebarHeader className="h-[34px] justify-center px-2 py-0">
        <div className="flex h-full min-w-0 items-center gap-2 overflow-hidden pl-[14px] pr-2">
          <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
            <span className="brand-mark app-sidebar-logo" />
          </span>
          <strong className="min-w-0 flex-1 truncate text-base font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">{appTitle}</strong>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navRoutes.map((route) => {
                const Icon = route.icon
                const active = activeView === route.id
                return (
                  <SidebarMenuItem key={route.id}>
                    <SidebarMenuButton
                      type="button"
                      size="nav"
                      isActive={active}
                      tooltip={t(route.labelKey)}
                      aria-current={active ? "page" : undefined}
                      className="data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground"
                      onClick={() => onNavigate(route.id)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{t(route.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <Separator className="bg-sidebar-border" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              size="nav"
              isActive={activeView === "settings"}
              tooltip={t("nav:settings")}
              aria-current={activeView === "settings" ? "page" : undefined}
              className="data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground"
              onClick={() => onNavigate("settings")}
            >
              <Settings aria-hidden="true" />
              <span>{t("nav:settings")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {!isElectron ? (
            <>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  size="nav"
                  tooltip={updateButtonTitle}
                  disabled={updateStatus === "checking" || updateStatus === "updating"}
                  onClick={onUpdateClick}
                >
                  <UpdateIcon className={updateStatus === "checking" || updateStatus === "updating" ? "animate-spin" : undefined} aria-hidden="true" />
                  <span>{updateButtonLabel}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton type="button" size="nav" tooltip={themeToggleLabel} aria-pressed={theme === "dark"} onClick={onToggleTheme}>
                  <ThemeIcon aria-hidden="true" />
                  <span>{themeToggleLabel}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton type="button" size="nav" tooltip={languageTitle} onClick={onToggleLanguage}>
                  <Languages aria-hidden="true" />
                  <span>{languageCode}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </>
          ) : null}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

export function AppSidebarTrigger() {
  const { t } = useTranslation()
  const { state } = useSidebar()
  const label = state === "collapsed" ? t("nav:expandSidebar") : t("nav:collapseSidebar")
  return <SidebarTrigger aria-label={label} title={label} />
}
