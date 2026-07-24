const fs = require('fs');
const FILE = 'docs/frontend/design-proposal/mis-portal-prototype.html';
const norm = s => s.split('\r\n').join('\n');
let h = norm(fs.readFileSync(FILE, 'utf8'));
const engine = norm(fs.readFileSync('.workbuddy/_sa_engine.js', 'utf8'));
const scopedCss = norm(fs.readFileSync('.workbuddy/_sa_css.css', 'utf8'));

/* ---------- 1. 持久 SA 抽屉 / 确认 / 提示（置于视图容器外，避免被 enterSubsystem 重写） ---------- */
const overlayMarkup = `  <!-- 系统管理·CRUD 抽屉 / 确认 / 提示（持久，置于视图容器外） -->
  <div id="sa-sheet-overlay" class="sa-sheet-overlay"></div>
  <aside id="sa-sheet-panel" class="sa-sheet-panel" aria-label="系统管理记录">
    <div class="sa-sheet-header">
      <div class="sa-sheet-title" id="sa-sheet-title">—</div>
      <button class="icon-btn" id="sa-sheet-close" aria-label="关闭"></button>
    </div>
    <div class="sa-sheet-body" id="sa-sheet-body"></div>
    <div class="sa-sheet-footer" id="sa-sheet-footer"></div>
  </aside>
  <div id="sa-confirm-overlay" class="sa-confirm-overlay">
    <div class="sa-confirm-box">
      <h3>确认删除</h3>
      <p id="sa-confirm-text">确定要删除该记录吗？此操作不可撤销。</p>
      <div class="cf-actions">
        <button class="btn btn-outline" id="sa-confirm-cancel">取消</button>
        <button class="btn btn-destructive" id="sa-confirm-ok">删除</button>
      </div>
    </div>
  </div>
  <div class="sa-toast" id="sa-toast"></div>
`;
const anchor1 = '<section id="view-subsystem" class="view hidden"></section>';
if (!h.includes(anchor1)) { console.error('anchor1 missing'); process.exit(1); }
h = h.replace(anchor1, anchor1 + '\n' + overlayMarkup);

/* ---------- 2. SA 作用域 CSS + 抽屉/确认/提示 CSS（插入 </style> 前） ---------- */
const saCssBlock = `
/* ===== 系统管理·CRUD 引擎样式（scope 于 .sa-app，与门户组件隔离） ===== */
` + scopedCss + `
.sa-app { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.sa-app > .filter-card { flex-shrink: 0; }
.sa-app > .pager { flex-shrink: 0; }
.page-sub { font-size: .8125rem; color: hsl(var(--muted-foreground)); margin-top: .2rem; }
/* 系统管理抽屉（sa- 前缀，避开门户 AI 抽屉 #sheet-overlay） */
.sa-sheet-overlay { position: fixed; inset: 0; background: rgb(15 23 42 / .45); opacity: 0; pointer-events: none; transition: opacity 200ms ease; z-index: 50; }
.sa-sheet-overlay.open { opacity: 1; pointer-events: auto; }
.sa-sheet-panel { position: fixed; top: 0; right: 0; height: 100%; width: 32rem; max-width: 92vw; background: hsl(var(--card)); border-left: 1px solid hsl(var(--border)); box-shadow: -12px 0 40px -12px rgb(15 23 42 / .35); transform: translateX(100%); transition: transform 200ms ease; z-index: 51; display: flex; flex-direction: column; }
.sa-sheet-panel.open { transform: none; }
.sa-sheet-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 1px solid hsl(var(--border)); }
.sa-sheet-title { font-size: 1.05rem; font-weight: 600; }
.sa-sheet-body { flex: 1; overflow-y: auto; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
.sa-sheet-footer { padding: 1rem 1.25rem; border-top: 1px solid hsl(var(--border)); display: flex; justify-content: flex-end; gap: .5rem; }
.sa-confirm-overlay { position: fixed; inset: 0; background: rgb(15 23 42 / .45); display: none; align-items: center; justify-content: center; z-index: 60; }
.sa-confirm-overlay.open { display: flex; }
.sa-confirm-box { width: 24rem; max-width: 92vw; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: var(--radius); box-shadow: var(--card-hover-shadow); padding: 1.25rem; }
.sa-confirm-box h3 { font-size: 1rem; margin-bottom: .5rem; }
.sa-confirm-box p { font-size: .875rem; color: hsl(var(--muted-foreground)); margin-bottom: 1rem; }
.sa-confirm-box .cf-actions { display: flex; justify-content: flex-end; gap: .5rem; }
.sa-toast { position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%) translateY(1rem); background: hsl(var(--foreground)); color: hsl(var(--background)); padding: .6rem 1rem; border-radius: var(--radius); font-size: .85rem; opacity: 0; transition: all 200ms ease; z-index: 70; pointer-events: none; }
.sa-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
`;
const anchor2 = '</style>';
if (!h.includes(anchor2)) { console.error('anchor2 missing'); process.exit(1); }
h = h.replace(anchor2, saCssBlock + anchor2);

/* ---------- 3. 重构 系统管理 nav（5 组 + 概览，叶子带 saId） ---------- */
const navOld = `    nav: [
      { label: '概览', icon: 'layoutDashboard' },
      { label: '权限管理', icon: 'shield', children: [
        { label: '用户管理', icon: 'users' },
        { label: '组织管理', icon: 'network' },
        { label: '角色管理', icon: 'keyRound' },
        { label: '菜单管理', icon: 'list' }
      ]},
      { label: '字典管理', icon: 'book' },
      { label: '操作日志', icon: 'clipboard', badge: '12' }
    ],`;
const navNew = `    nav: [
      { label: '概览', icon: 'layoutDashboard' },
      { label: '组织架构', icon: 'network', children: [
        { label: '组织管理', icon: 'network', saId: 'org' },
        { label: '部门管理', icon: 'folderTree', saId: 'dept' },
        { label: '员工管理', icon: 'users', saId: 'employee' },
        { label: '岗位管理', icon: 'userCog', saId: 'post' }
      ]},
      { label: '应用与接口', icon: 'plug', children: [
        { label: '应用管理', icon: 'appWindow', saId: 'app' },
        { label: '接口管理', icon: 'api', saId: 'api' },
        { label: '模块管理', icon: 'gitBranch', saId: 'module' }
      ]},
      { label: '权限中心', icon: 'keyRound', children: [
        { label: '用户管理', icon: 'users', saId: 'user' },
        { label: '角色权限', icon: 'keyRound', saId: 'role' },
        { label: '菜单管理', icon: 'listTree', saId: 'menu' }
      ]},
      { label: '基础数据', icon: 'book', children: [
        { label: '字典管理', icon: 'book', saId: 'dict' },
        { label: '系统参数', icon: 'settings', saId: 'config' }
      ]},
      { label: '审计', icon: 'activity', children: [
        { label: '登录日志', icon: 'activity', saId: 'loginlog' },
        { label: '操作日志', icon: 'clipboard', saId: 'operlog' }
      ]}
    ],`;
if (!h.includes(navOld)) { console.error('navOld missing'); process.exit(1); }
h = h.replace(navOld, navNew);

/* ---------- 4. renderSubContent 通用 else 前插入 系统管理 SA 分支 ---------- */
/* 锚点：renderSubContent 通用 else 块开头（唯一：面包屑含 id="crumb-portal" 且后接 ${esc(s.name)}） */
const branchAnchor = "  } else {\n    root.innerHTML = `\n    <div class=\"page-header\">\n      <div>\n        <div class=\"breadcrumb\"><a href=\"#\" id=\"crumb-portal\">门户</a> <span>/</span> <span>${esc(s.name)}</span>";
if (!h.includes(branchAnchor)) { console.error('branchAnchor missing'); process.exit(1); }
/* SA 分支以纯文本存放（含字面反引号），用替换函数避免 $ 被当作特殊模式 */
const saBranch = norm(fs.readFileSync('.workbuddy/_sa_branch.js', 'utf8'));
h = h.replace(branchAnchor, () => saBranch);

/* ---------- 5. 引擎插入主脚本末尾（最后一个 </script> 前） ---------- */
const idx = h.lastIndexOf('</script>');
if (idx === -1) { console.error('no script close'); process.exit(1); }
h = h.slice(0, idx) + '\n/* ============================================================\n   系统管理·CRUD 引擎（来自 system-admin-template.html，数据驱动，scope 于 .sa-app）\n   ============================================================ */\n' + engine + '\n' + h.slice(idx);

fs.writeFileSync(FILE, h);
console.log('portal updated. new bytes=', h.length);

/* 校验整文件 JS 语法（每个 <script> 块） */
const m = h.match(/<script>([\s\S]*?)<\/script>/g);
let ok = true;
m.forEach((blk, i) => {
  const code = blk.replace(/^<script>/, '').replace(/<\/script>$/, '');
  try { new Function(code); } catch (e) { ok = false; console.error('SCRIPT #' + i + ' ERROR:', e.message); }
});
console.log(ok ? 'ALL SCRIPT BLOCKS SYNTAX OK (' + m.length + ')' : 'FAILED');
