/**
 * 后台可用图标集（lucide-vue-next 的**受控子集**）。
 *
 * 为什么不做"任意图标名动态解析"：插件是零构建的，浏览器无法解析裸模块名，
 * 因此图标必须由 SDK 打包进产物。全量 lucide（1500+ 图标）会让 SDK 产物膨胀数倍，
 * 所以这里只收录后台真实用到与插件高频需要的图标，其余一律回退。
 *
 * 插件用法（模板字符串，无需 import 注册）：
 *
 * ```html
 * <Icon name="plus" class="h-3.5 w-3.5" />
 * ```
 *
 * 需要新图标时向这里追加即可（Core 与插件共享同一份）。
 */

import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bell,
  Bug,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileStack,
  FileText,
  Filter,
  FolderTree,
  Globe,
  Hash,
  Image,
  Inbox,
  Info,
  Key,
  Layers,
  LayoutDashboard,
  Link,
  List,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Navigation,
  Package,
  Palette,
  Pencil,
  Play,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  ScrollText,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Tags,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Upload,
  UserRound,
  Users,
  X,
  type LucideIcon
} from 'lucide-vue-next';

/** 名称 → 图标组件（名称不区分大小写）。 */
export const ICONS: Record<string, LucideIcon> = {
  alertcircle: AlertCircle,
  alerttriangle: AlertTriangle,
  archive: Archive,
  arrowdown: ArrowDown,
  arrowright: ArrowRight,
  arrowup: ArrowUp,
  bell: Bell,
  bug: Bug,
  calendar: Calendar,
  check: Check,
  checkcircle: CheckCircle2,
  chevrondown: ChevronDown,
  chevronleft: ChevronLeft,
  chevronright: ChevronRight,
  chevronup: ChevronUp,
  clock: Clock,
  copy: Copy,
  database: Database,
  download: Download,
  externallink: ExternalLink,
  eye: Eye,
  filestack: FileStack,
  filetext: FileText,
  filter: Filter,
  foldertree: FolderTree,
  globe: Globe,
  hash: Hash,
  image: Image,
  inbox: Inbox,
  info: Info,
  key: Key,
  layers: Layers,
  layoutdashboard: LayoutDashboard,
  link: Link,
  list: List,
  loader: Loader2,
  lock: Lock,
  logout: LogOut,
  mail: Mail,
  menu: Menu,
  messagesquare: MessageSquare,
  navigation: Navigation,
  package: Package,
  palette: Palette,
  pencil: Pencil,
  play: Play,
  plug: Plug,
  plus: Plus,
  puzzle: Puzzle,
  refresh: RefreshCw,
  rotateccw: RotateCcw,
  rotate: RotateCw,
  save: Save,
  scrolltext: ScrollText,
  search: Search,
  settings: Settings,
  shield: Shield,
  shieldcheck: ShieldCheck,
  sparkles: Sparkles,
  star: Star,
  tags: Tags,
  trash: Trash2,
  trendingup: TrendingUp,
  trianglealert: TriangleAlert,
  upload: Upload,
  userround: UserRound,
  users: Users,
  x: X
};

/** 解析图标名；未收录时回退到中性圆点图标（不抛错、不空白）。 */
export function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return Circle;
  const normalized = name.replace(/[\s_-]/g, '').toLowerCase();
  return ICONS[normalized] ?? Circle;
}

export type { LucideIcon };
