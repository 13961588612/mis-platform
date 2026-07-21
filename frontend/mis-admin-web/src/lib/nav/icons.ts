import {
  Activity,
  AppWindow,
  BookOpen,
  Building2,
  Cable,
  ClipboardList,
  FileText,
  FolderTree,
  GitBranch,
  Home,
  KeyRound,
  LayoutDashboard,
  ListTree,
  LogIn,
  Menu,
  Network,
  Settings,
  Shield,
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
  UserCog,
  AppWindow,
  Cable,
  KeyRound,
  ListTree,
  Activity,
  ClipboardList,
};

export function resolveNavIcon(name?: string | null): LucideIcon {
  if (!name) return LayoutDashboard;
  return ICON_MAP[name] ?? LayoutDashboard;
}
