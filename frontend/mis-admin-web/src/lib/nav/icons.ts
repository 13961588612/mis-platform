import {
  Activity,
  AppWindow,
  BarChart3,
  BookOpen,
  Building2,
  Cable,
  ClipboardList,
  Cpu,
  Crosshair,
  Database,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  Home,
  KeyRound,
  Languages,
  LayoutDashboard,
  ListTree,
  Lock,
  LogIn,
  Menu,
  Network,
  Settings,
  Shield,
  Sparkles,
  UserCog,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Settings,
  Users,
  Building2,
  Shield,
  Home,
  GitBranch,
  Menu,
  BookOpen,
  LogIn,
  FileText,
  Network,
  FolderTree,
  Globe,
  UserCog,
  AppWindow,
  Cable,
  KeyRound,
  ListTree,
  Activity,
  ClipboardList,
  // 知识库子系统（V13__kb_seed.sql 中 sys_menu.icon 取值）
  Database,
  Lock,
  Sparkles,
  BarChart3,
  Cpu,
  // Wave D：命中测试（Crosshair 在 WA-08 即已使用，这里补登记以免被 eslint 报未使用导入）
  Crosshair,
  // Wave D：同义词管理（Languages，V18 seed）
  Languages,
};

export function resolveNavIcon(name?: string | null): LucideIcon {
  if (!name) return LayoutDashboard;
  return ICON_MAP[name] ?? LayoutDashboard;
}
