const SA_ICONS = {
  layoutDashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  network: '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M12 12H5v4M12 12h7v4"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  keyRound: '<path d="M2 18v3h3M22 4 11 15M13 11l1 1M16 8l1 1M21 3l-1 1M18 6l-1 1"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M6 8h12v4a6 6 0 0 1-12 0z"/>',
  appWindow: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/>',
  api: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6"/>',
  gitBranch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  userCog: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h2M18 14l-1 5h-4l-1 4-3-3 3-3h4z"/>',
  listTree: '<path d="M21 12h-8M21 6h-8M21 18h-8M4 4v16a2 2 0 0 0 2 2M4 6h2M4 12h2M4 18h2"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  folderTree: '<path d="M13 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7z"/><path d="M2 9h20M7 13h2M7 17h2"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>'
};
Object.keys(SA_ICONS).forEach(function (k) { if (!ICONS[k]) ICONS[k] = SA_ICONS[k]; });
const saMENU_TREE = [
  { id: 'm1', name: '系统管理', children: [
    { id: 'm1-0', name: '概览' },
    { id: 'm1-2', name: '权限管理', children: [
      { id: 'm1-2-1', name: '用户管理' },
      { id: 'm1-2-2', name: '组织管理' },
      { id: 'm1-2-3', name: '角色管理' },
      { id: 'm1-2-4', name: '菜单管理' }
    ]},
    { id: 'm1-3', name: '字典管理' },
    { id: 'm1-4', name: '操作日志' }
  ]},
  { id: 'm2', name: '统一身份 IAM', children: [
    { id: 'm2-1', name: '账号目录' },
    { id: 'm2-2', name: '应用授权' },
    { id: 'm2-3', name: '单点登录' }
  ]},
  { id: 'm3', name: '流程中心', children: [
    { id: 'm3-1', name: '待办任务' },
    { id: 'm3-2', name: '已办归档' }
  ]}
];
const saALL_MENU_IDS = (function collect(nodes, acc) { nodes.forEach(n => { acc.push(n.id); if (n.children) collect(n.children, acc); }); return acc; })(saMENU_TREE, []);
const saDATA_SCOPE = [
  { value: 1, label: '全部数据' }, { value: 2, label: '本部门' }, { value: 3, label: '本部门及下级' },
  { value: 4, label: '仅本人' }, { value: 5, label: '自定义部门' }, { value: 6, label: '本组织' }
];
const saSTATUS_OPTS = [ { value: 1, label: '启用' }, { value: 0, label: '禁用' } ];

/* ============================================================ 页面定义（数据驱动） ============================================================ */
const saPAGES = {
  /* ---------- 组织架构 ---------- */
  org: {
    group: '组织架构', title: '组织管理', icon: 'network', desc: '租户下的业务组织（sys_org），扁平列表、可启停。',
    filters: [ { key: 'name', label: '组织名称', type: 'text', col: 4 }, { key: 'status', label: '状态', type: 'select', col: 2, options: saSTATUS_OPTS } ],
    columns: [ { key: 'code', label: '编码' }, { key: 'name', label: '组织名称' }, { key: 'sort', label: '排序' }, { key: 'statusText', label: '状态', status: true }, { key: 'remark', label: '备注' } ],
    form: [ { key: 'code', label: '组织编码', type: 'text', col: 6, required: true }, { key: 'name', label: '组织名称', type: 'text', col: 6, required: true }, { key: 'sort', label: '排序', type: 'number', col: 6 }, { key: 'status', label: '状态', type: 'switch', col: 6 }, { key: 'remark', label: '备注', type: 'textarea', col: 12 } ],
    sample: [
      { id: 1, code: 'headquarters', name: '总部', sort: 1, status: 1, remark: '默认组织' },
      { id: 2, code: 'north', name: '北方大区', sort: 2, status: 1, remark: '华北业务' },
      { id: 3, code: 'south', name: '南方大区', sort: 3, status: 0, remark: '待启用' }
    ]
  },
  dept: {
    group: '组织架构', title: '部门管理', icon: 'folderTree', desc: '组织内部门树（sys_dept），含部门类别与负责人。',
    filters: [ { key: 'name', label: '部门名称', type: 'text', col: 4 }, { key: 'org', label: '所属组织', type: 'select', col: 3, options: [ { value: '总部', label: '总部' }, { value: '北方大区', label: '北方大区' } ] }, { key: 'status', label: '状态', type: 'select', col: 2, options: saSTATUS_OPTS } ],
    columns: [ { key: 'code', label: '层级编码' }, { key: 'name', label: '部门名称' }, { key: 'org', label: '所属组织' }, { key: 'category', label: '类别' }, { key: 'leader', label: '负责人' }, { key: 'statusText', label: '状态', status: true } ],
    form: [ { key: 'org', label: '所属组织', type: 'select', col: 6, required: true, options: [ { value: '总部', label: '总部' }, { value: '北方大区', label: '北方大区' } ] }, { key: 'code', label: '层级编码', type: 'text', col: 6, required: true, placeholder: '如 0001 / 00010001' }, { key: 'name', label: '部门名称', type: 'text', col: 6, required: true }, { key: 'category', label: '部门类别', type: 'select', col: 6, options: [ { value: '总部', label: '总部' }, { value: '分公司', label: '分公司' }, { value: '部门', label: '部门' } ] }, { key: 'leader', label: '负责人', type: 'text', col: 6 }, { key: 'status', label: '状态', type: 'switch', col: 6 } ],
    sample: [
      { id: 1, code: '0001', name: '总经理办公室', org: '总部', category: '总部', leader: '李文博', status: 1 },
      { id: 2, code: '00010001', name: '研发中心', org: '总部', category: '部门', leader: '王磊', status: 1 },
      { id: 3, code: '00010002', name: '财务部', org: '总部', category: '部门', leader: '赵敏', status: 1 },
      { id: 4, code: '0002', name: '华北分公司', org: '北方大区', category: '分公司', leader: '孙强', status: 0 }
    ]
  },
  employee: {
    group: '组织架构', title: '员工管理', icon: 'users', desc: '租户员工自然人主数据（sys_employee），关联主部门。',
    filters: [ { key: 'real_name', label: '姓名', type: 'text', col: 4 }, { key: 'dept', label: '主部门', type: 'select', col: 4, options: [ { value: '总经理办公室', label: '总经理办公室' }, { value: '研发中心', label: '研发中心' }, { value: '财务部', label: '财务部' } ] }, { key: 'status', label: '状态', type: 'select', col: 2, options: saSTATUS_OPTS } ],
    columns: [ { key: 'employee_no', label: '工号' }, { key: 'real_name', label: '姓名' }, { key: 'genderText', label: '性别' }, { key: 'dept', label: '主部门' }, { key: 'title', label: '职位' }, { key: 'statusText', label: '状态', status: true } ],
    form: [ { key: 'employee_no', label: '工号', type: 'text', col: 6, required: true }, { key: 'real_name', label: '姓名', type: 'text', col: 6, required: true }, { key: 'gender', label: '性别', type: 'select', col: 4, options: [ { value: 1, label: '男' }, { value: 2, label: '女' } ] }, { key: 'dept', label: '主部门', type: 'select', col: 4, options: [ { value: '总经理办公室', label: '总经理办公室' }, { value: '研发中心', label: '研发中心' }, { value: '财务部', label: '财务部' } ] }, { key: 'title', label: '职位', type: 'text', col: 4 }, { key: 'email', label: '邮箱', type: 'text', col: 6 }, { key: 'phone', label: '手机号', type: 'text', col: 6 }, { key: 'hire_date', label: '入职日期', type: 'text', col: 6 }, { key: 'status', label: '状态', type: 'switch', col: 6 } ],
    sample: [
      { id: 1, employee_no: 'E1001', real_name: '李文博', gender: 1, dept: '总经理办公室', title: '总经理', email: 'liwb@corp.com', phone: '13800001001', hire_date: '2020-03-01', status: 1 },
      { id: 2, employee_no: 'E1002', real_name: '王磊', gender: 1, dept: '研发中心', title: '研发总监', email: 'wl@corp.com', phone: '13800001002', hire_date: '2021-06-15', status: 1 },
      { id: 3, employee_no: 'E1003', real_name: '赵敏', gender: 2, dept: '财务部', title: '财务经理', email: 'zm@corp.com', phone: '13800001003', hire_date: '2021-09-01', status: 1 },
      { id: 4, employee_no: 'E1004', real_name: '孙强', gender: 1, dept: '总经理办公室', title: '大区总', email: 'sq@corp.com', phone: '13800001004', hire_date: '2019-11-20', status: 0 }
    ]
  },
  post: {
    group: '组织架构', title: '岗位管理', icon: 'userCog', desc: '部门岗位编制（sys_post / sys_post_type），支持兼职多岗。',
    filters: [ { key: 'name', label: '岗位名称', type: 'text', col: 4 }, { key: 'dept', label: '所属部门', type: 'select', col: 4, options: [ { value: '总经理办公室', label: '总经理办公室' }, { value: '研发中心', label: '研发中心' }, { value: '财务部', label: '财务部' } ] }, { key: 'status', label: '状态', type: 'select', col: 2, options: saSTATUS_OPTS } ],
    columns: [ { key: 'code', label: '岗位编码' }, { key: 'name', label: '岗位名称' }, { key: 'dept', label: '所属部门' }, { key: 'post_type', label: '岗位类型' }, { key: 'statusText', label: '状态', status: true } ],
    form: [ { key: 'dept', label: '所属部门', type: 'select', col: 6, required: true, options: [ { value: '总经理办公室', label: '总经理办公室' }, { value: '研发中心', label: '研发中心' }, { value: '财务部', label: '财务部' } ] }, { key: 'post_type', label: '岗位类型', type: 'select', col: 6, options: [ { value: 'management', label: '管理' }, { value: 'tech', label: '技术' }, { value: 'finance', label: '财务' } ] }, { key: 'code', label: '岗位编码', type: 'text', col: 6, required: true }, { key: 'name', label: '岗位名称', type: 'text', col: 6, required: true }, { key: 'status', label: '状态', type: 'switch', col: 6 } ],
    sample: [
      { id: 1, code: 'GM', name: '总经理', dept: '总经理办公室', post_type: 'management', status: 1 },
      { id: 2, code: 'RD-L', name: '研发部经理', dept: '研发中心', post_type: 'tech', status: 1 },
      { id: 3, code: 'FIN-L', name: '财务主管', dept: '财务部', post_type: 'finance', status: 1 }
    ]
  },

  /* ---------- 应用与接口 ---------- */
  app: {
    group: '应用与接口', title: '应用管理', icon: 'appWindow', desc: '门户子系统 / 微前端应用边界（sys_app）。',
    filters: [ { key: 'name', label: '应用名称', type: 'text', col: 4 }, { key: 'kind', label: '种类', type: 'select', col: 3, options: [ { value: 'subsystem', label: '子系统' }, { value: 'tool', label: '工具' } ] }, { key: 'status', label: '状态', type: 'select', col: 2, options: saSTATUS_OPTS } ],
    columns: [ { key: 'code', label: '编码' }, { key: 'name', label: '名称' }, { key: 'base_path', label: '路由前缀' }, { key: 'kind', label: '种类' }, { key: 'runtime', label: '运行方式' }, { key: 'statusText', label: '状态', status: true } ],
    form: [ { key: 'code', label: '应用编码', type: 'text', col: 6, required: true }, { key: 'name', label: '应用名称', type: 'text', col: 6, required: true }, { key: 'icon', label: '图标(lucide)', type: 'text', col: 4 }, { key: 'base_path', label: '路由前缀', type: 'text', col: 4, placeholder: '/system' }, { key: 'portal_group', label: '门户分组', type: 'text', col: 4 }, { key: 'kind', label: '种类', type: 'select', col: 4, options: [ { value: 'subsystem', label: '子系统' }, { value: 'tool', label: '工具' } ] }, { key: 'runtime', label: '运行方式', type: 'select', col: 4, options: [ { value: 'host', label: '同仓壳内' }, { value: 'remote', label: 'Module Federation' } ] }, { key: 'sort', label: '排序', type: 'number', col: 4 }, { key: 'status', label: '状态', type: 'switch', col: 6 } ],
    sample: [
      { id: 1, code: 'system', name: '系统管理', icon: 'layoutDashboard', base_path: '/system', kind: 'subsystem', runtime: 'host', portal_group: 'governance', sort: 1, status: 1 },
      { id: 2, code: 'iam', name: '统一身份 IAM', icon: 'shieldCheck', base_path: '/iam', kind: 'subsystem', runtime: 'host', portal_group: 'governance', sort: 2, status: 1 },
      { id: 3, code: 'ops', name: '运营中心', icon: 'activity', base_path: '/ops', kind: 'subsystem', runtime: 'remote', portal_group: 'operations', sort: 3, status: 1 }
    ]
  },
  api: {
    group: '应用与接口', title: '接口管理', icon: 'api', desc: 'HTTP 接口树（sys_api），与菜单/按钮关联鉴权。',
    filters: [ { key: 'name', label: '名称', type: 'text', col: 4 }, { key: 'type', label: '类型', type: 'select', col: 3, options: [ { value: 'catalog', label: '目录' }, { value: 'api', label: '接口' } ] }, { key: 'module', label: '模块', type: 'select', col: 3, options: [ { value: 'user', label: '用户' }, { value: 'org', label: '组织' }, { value: 'system', label: '系统' }, { value: 'audit', label: '审计' } ] } ],
    columns: [ { key: 'code', label: '层级编码' }, { key: 'name', label: '名称' }, { key: 'typeText', label: '类型' }, { key: 'http_method', label: '方法' }, { key: 'path_pattern', label: '路径' }, { key: 'statusText', label: '状态', status: true } ],
    form: [ { key: 'module', label: '所属模块', type: 'select', col: 6, required: true, options: [ { value: 'user', label: '用户' }, { value: 'org', label: '组织' }, { value: 'system', label: '系统' }, { value: 'audit', label: '审计' } ] }, { key: 'code', label: '层级编码', type: 'text', col: 6, required: true, placeholder: '如 00010001' }, { key: 'type', label: '类型', type: 'select', col: 4, options: [ { value: 'catalog', label: '目录' }, { value: 'api', label: '接口' } ] }, { key: 'http_method', label: 'HTTP 方法', type: 'select', col: 4, options: [ { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }, { value: 'DELETE', label: 'DELETE' } ] }, { key: 'name', label: '名称', type: 'text', col: 6, required: true }, { key: 'path_pattern', label: '路径模式', type: 'text', col: 6, placeholder: '/api/v1/users' }, { key: 'sort', label: '排序', type: 'number', col: 6 }, { key: 'status', label: '状态', type: 'switch', col: 6 } ],
    sample: [
      { id: 1, code: '0001', name: '用户模块', type: 'catalog', module: 'user', http_method: '', path_pattern: '', status: 1 },
      { id: 2, code: '00010001', name: '查询用户列表', type: 'api', module: 'user', http_method: 'GET', path_pattern: '/api/v1/users', status: 1 },
      { id: 3, code: '00010002', name: '创建用户', type: 'api', module: 'user', http_method: 'POST', path_pattern: '/api/v1/users', status: 1 },
      { id: 4, code: '0002', name: '组织模块', type: 'catalog', module: 'org', http_method: '', path_pattern: '', status: 1 }
    ]
  },
  module: {
    group: '应用与接口', title: '模块管理', icon: 'gitBranch', desc: '平台业务模块（sys_module），与微服务 1:1，平台级。',
    filters: [ { key: 'name', label: '模块名称', type: 'text', col: 4 }, { key: 'status', label: '状态', type: 'select', col: 2, options: saSTATUS_OPTS } ],
    columns: [ { key: 'code', label: '编码' }, { key: 'name', label: '名称' }, { key: 'service_name', label: 'Nacos 服务名' }, { key: 'sort', label: '排序' }, { key: 'statusText', label: '状态', status: true } ],
    form: [ { key: 'code', label: '模块编码', type: 'text', col: 6, required: true }, { key: 'name', label: '模块名称', type: 'text', col: 6, required: true }, { key: 'service_name', label: 'Nacos 服务名', type: 'text', col: 6, placeholder: 'mis-iam' }, { key: 'sort', label: '排序', type: 'number', col: 6 }, { key: 'status', label: '状态', type: 'switch', col: 6 } ],
    sample: [
      { id: 1, code: 'user', name: '用户模块', service_name: 'mis-iam', sort: 1, status: 1 },
      { id: 2, code: 'org', name: '组织模块', service_name: 'mis-org', sort: 2, status: 1 },
      { id: 3, code: 'system', name: '系统模块', service_name: 'mis-system', sort: 3, status: 1 },
      { id: 4, code: 'audit', name: '审计模块', service_name: 'mis-audit', sort: 4, status: 1 }
    ]
  },

  /* ---------- 权限中心 ---------- */
  user: {
    group: '权限中心', title: '用户管理', icon: 'users', desc: 'APP 登录账号（sys_user），每员工每应用一条，关联角色。',
    filters: [ { key: 'username', label: '登录名', type: 'text', col: 4 }, { key: 'app', label: '所属应用', type: 'select', col: 3, options: [ { value: 'system', label: '系统管理' }, { value: 'iam', label: 'IAM' } ] }, { key: 'status', label: '状态', type: 'select', col: 2, options: [ { value: 1, label: '启用' }, { value: 0, label: '禁用' }, { value: 2, label: '锁定' } ] } ],
    columns: [ { key: 'username', label: '登录名' }, { key: 'employee', label: '关联员工' }, { key: 'app', label: '所属应用' }, { key: 'roles', label: '角色' }, { key: 'statusText', label: '状态', status: true }, { key: 'last_login', label: '最近登录' } ],
    form: [ { key: 'username', label: '登录名', type: 'text', col: 6, required: true }, { key: 'employee', label: '关联员工', type: 'select', col: 6, required: true, options: [ { value: '李文博', label: '李文博' }, { value: '王磊', label: '王磊' }, { value: '赵敏', label: '赵敏' } ] }, { key: 'app', label: '所属应用', type: 'select', col: 6, options: [ { value: 'system', label: '系统管理' }, { value: 'iam', label: 'IAM' } ] }, { key: 'roles', label: '角色', type: 'select', col: 6, options: [ { value: 'TENANT_ADMIN', label: '租户管理员' }, { value: 'OPERATOR', label: '操作员' } ] }, { key: 'status', label: '状态', type: 'switch', col: 6 }, { key: 'is_tenant_admin', label: '租户管理员', type: 'switch', col: 6 } ],
    sample: [
      { id: 1, username: 'admin', employee: '李文博', app: 'system', roles: 'TENANT_ADMIN', status: 1, is_tenant_admin: 1, last_login: '2026-07-21 09:12' },
      { id: 2, username: 'wangl', employee: '王磊', app: 'system', roles: 'OPERATOR', status: 1, is_tenant_admin: 0, last_login: '2026-07-20 14:30' },
      { id: 3, username: 'zhaom', employee: '赵敏', app: 'iam', roles: 'OPERATOR', status: 2, is_tenant_admin: 0, last_login: '2026-07-19 11:05' }
    ]
  },
  role: {
    group: '权限中心', title: '角色权限', icon: 'keyRound', desc: 'APP 级角色（sys_role），分配用户与菜单权限 + 数据范围。',
    filters: [ { key: 'name', label: '角色名称', type: 'text', col: 4 }, { key: 'type', label: '类型', type: 'select', col: 3, options: [ { value: 1, label: '内置' }, { value: 2, label: '自定义' } ] }, { key: 'status', label: '状态', type: 'select', col: 2, options: saSTATUS_OPTS } ],
    columns: [ { key: 'code', label: '编码' }, { key: 'name', label: '名称' }, { key: 'typeText', label: '类型' }, { key: 'dataScopeText', label: '数据范围' }, { key: 'userCount', label: '用户数' }, { key: 'statusText', label: '状态', status: true } ],
    form: [ { key: 'code', label: '角色编码', type: 'text', col: 6, required: true }, { key: 'name', label: '角色名称', type: 'text', col: 6, required: true }, { key: 'type', label: '类型', type: 'select', col: 4, options: [ { value: 1, label: '内置' }, { value: 2, label: '自定义' } ] }, { key: 'data_scope', label: '数据范围', type: 'select', col: 4, options: saDATA_SCOPE }, { key: 'status', label: '状态', type: 'switch', col: 4 }, { key: 'remark', label: '备注', type: 'textarea', col: 12 }, { key: 'permissions', label: '菜单权限', type: 'tree', col: 12 } ],
    customDetail: (row) => {
      const ids = row.permissions || [];
      const names = [];
      (function walk(ns){ ns.forEach(n=>{ if(ids.includes(n.id)) names.push(n.name); if(n.children) walk(n.children); }); })(saMENU_TREE);
      return '<div class="ro-field"><span class="ro-k">菜单权限</span><span class="ro-v">' + (names.length ? esc(names.join('、')) : '—') + '</span></div>';
    },
    sample: [
      { id: 1, code: 'TENANT_ADMIN', name: '租户管理员', type: 1, data_scope: 1, status: 1, remark: '内置，全部菜单权限', users: ['admin'], permissions: saALL_MENU_IDS },
      { id: 2, code: 'OPERATOR', name: '操作员', type: 2, data_scope: 3, status: 1, remark: '日常操作', users: ['wangl', 'zhaom'], permissions: ['m1-0', 'm1-2-1', 'm1-2-2', 'm1-2-3', 'm1-2-4', 'm1-3'] }
    ]
  },
  menu: {
    group: '权限中心', title: '菜单管理', icon: 'listTree', desc: '菜单树（sys_menu）：目录 / 菜单 / 按钮，绑定 permission 鉴权。',
    filters: [ { key: 'name', label: '菜单名称', type: 'text', col: 4 }, { key: 'type', label: '类型', type: 'select', col: 3, options: [ { value: 1, label: '目录' }, { value: 2, label: '菜单' }, { value: 3, label: '按钮' } ] }, { key: 'status', label: '状态', type: 'select', col: 2, options: saSTATUS_OPTS } ],
    columns: [ { key: 'code', label: '层级编码' }, { key: 'name', label: '名称' }, { key: 'typeText', label: '类型' }, { key: 'path', label: '路由' }, { key: 'permission', label: '权限标识' }, { key: 'statusText', label: '状态', status: true } ],
    form: [ { key: 'parent_id', label: '父级', type: 'select', col: 6, options: [ { value: 0, label: '根节点' }, { value: 'm1', label: '系统管理' }, { value: 'm1-2', label: '权限管理' } ] }, { key: 'code', label: '层级编码', type: 'text', col: 6, required: true, placeholder: '如 00010001' }, { key: 'name', label: '名称', type: 'text', col: 6, required: true }, { key: 'type', label: '类型', type: 'select', col: 6, options: [ { value: 1, label: '目录' }, { value: 2, label: '菜单' }, { value: 3, label: '按钮' } ] }, { key: 'path', label: '路由', type: 'text', col: 6, placeholder: '/system/users' }, { key: 'component', label: '组件', type: 'text', col: 6 }, { key: 'permission', label: '权限标识', type: 'text', col: 6, placeholder: 'system:user:list' }, { key: 'icon', label: '图标', type: 'text', col: 4 }, { key: 'sort', label: '排序', type: 'number', col: 4 }, { key: 'visible', label: '可见', type: 'switch', col: 4 }, { key: 'status', label: '状态', type: 'switch', col: 6 } ],
    sample: [
      { id: 1, code: '0001', name: '系统管理', type: 1, path: '', permission: '', icon: 'layoutDashboard', sort: 1, visible: 1, status: 1 },
      { id: 2, code: '00010001', name: '用户管理', type: 2, path: '/system/users', component: 'UserPage', permission: 'system:user:list', icon: 'users', sort: 1, visible: 1, status: 1 },
      { id: 3, code: '000100010001', name: '新增用户', type: 3, path: '', component: '', permission: 'system:user:create', icon: '', sort: 1, visible: 1, status: 1 }
    ]
  },

  /* ---------- 基础数据 ---------- */
  dict: {
    group: '基础数据', title: '字典管理', icon: 'book', desc: '字典类型与字典项（sys_dict_type / sys_dict_item）。',
    filters: [ { key: 'name', label: '类型名称', type: 'text', col: 4 }, { key: 'status', label: '状态', type: 'select', col: 2, options: saSTATUS_OPTS } ],
    columns: [ { key: 'code', label: '类型编码' }, { key: 'name', label: '类型名称' }, { key: 'itemCount', label: '字典项数' }, { key: 'statusText', label: '状态', status: true } ],
    form: [ { key: 'code', label: '类型编码', type: 'text', col: 6, required: true }, { key: 'name', label: '类型名称', type: 'text', col: 6, required: true }, { key: 'status', label: '状态', type: 'switch', col: 6 }, { key: 'items', label: '字典项(标签=值, 每行一条)', type: 'textarea', col: 12, placeholder: '男=1\n女=2' } ],
    sample: [
      { id: 1, code: 'gender', name: '性别', status: 1, items: '男=1\n女=2' },
      { id: 2, code: 'data_scope', name: '数据范围', status: 1, items: '全部数据=1\n本部门=2\n本部门及下级=3\n仅本人=4\n自定义部门=5\n本组织=6' }
    ]
  },
  config: {
    group: '基础数据', title: '系统参数', icon: 'settings', desc: '系统参数键值对（sys_config）。',
    filters: [ { key: 'config_key', label: '参数键', type: 'text', col: 6 }, { key: 'remark', label: '备注', type: 'text', col: 4 } ],
    columns: [ { key: 'config_key', label: '参数键' }, { key: 'config_value', label: '参数值' }, { key: 'remark', label: '备注' } ],
    form: [ { key: 'config_key', label: '参数键', type: 'text', col: 12, required: true, placeholder: 'security.password.min_length' }, { key: 'config_value', label: '参数值', type: 'textarea', col: 12, required: true }, { key: 'remark', label: '备注', type: 'text', col: 12 } ],
    sample: [
      { id: 1, config_key: 'security.password.min_length', config_value: '8', remark: '密码最小长度' },
      { id: 2, config_key: 'security.login.max_fail', config_value: '5', remark: '最大失败次数' },
      { id: 3, config_key: 'security.login.lock_minutes', config_value: '30', remark: '锁定分钟数' },
      { id: 4, config_key: 'security.token.access_ttl', config_value: '7200', remark: '访问令牌有效期(秒)' },
      { id: 5, config_key: 'user.default_password', config_value: 'Mis@123456', remark: '默认密码' }
    ]
  },

  /* ---------- 审计（只读） ---------- */
  loginlog: {
    group: '审计', title: '登录日志', icon: 'activity', desc: '登录审计（sys_login_log），只读。',
    readonly: true,
    filters: [ { key: 'username', label: '用户名', type: 'text', col: 4 }, { key: 'status', label: '结果', type: 'select', col: 3, options: [ { value: 1, label: '成功' }, { value: 0, label: '失败' } ] } ],
    columns: [ { key: 'username', label: '用户名' }, { key: 'ip', label: 'IP' }, { key: 'statusText', label: '结果', status: true }, { key: 'msg', label: '说明' }, { key: 'login_at', label: '登录时间' } ],
    form: [],
    sample: [
      { id: 1, username: 'admin', ip: '10.0.0.5', status: 1, msg: '登录成功', login_at: '2026-07-21 09:12:33' },
      { id: 2, username: 'zhaom', ip: '10.0.0.9', status: 0, msg: '密码错误', login_at: '2026-07-21 08:55:10' },
      { id: 3, username: 'wangl', ip: '10.0.0.7', status: 1, msg: '登录成功', login_at: '2026-07-20 14:30:02' }
    ]
  },
  operlog: {
    group: '审计', title: '操作日志', icon: 'clipboard', desc: '操作审计（sys_oper_log），只读。',
    readonly: true,
    filters: [ { key: 'module', label: '模块', type: 'text', col: 4 }, { key: 'username', label: '操作人', type: 'text', col: 4 } ],
    columns: [ { key: 'username', label: '操作人' }, { key: 'module', label: '模块' }, { key: 'operation', label: '操作' }, { key: 'request_method', label: '方法' }, { key: 'response_code', label: '状态码' }, { key: 'duration_ms', label: '耗时(ms)' }, { key: 'oper_time', label: '时间' } ],
    form: [],
    sample: [
      { id: 1, username: 'admin', module: '系统管理', operation: '新增组织', request_method: 'POST', request_uri: '/api/v1/orgs', response_code: 200, duration_ms: 23, oper_time: '2026-07-21 10:02:11' },
      { id: 2, username: 'admin', module: '系统管理', operation: '修改角色', request_method: 'PUT', request_uri: '/api/v1/roles/2', response_code: 200, duration_ms: 41, oper_time: '2026-07-21 09:48:30' },
      { id: 3, username: 'wangl', module: '组织管理', operation: '查询部门', request_method: 'GET', request_uri: '/api/v1/depts', response_code: 200, duration_ms: 12, oper_time: '2026-07-20 16:20:05' }
    ]
  }
};

/* 派生展示字段 */
function saDecorate(page, row) {
  const r = Object.assign({}, row);
  if ('status' in r) r.statusText = r.status === 1 ? '启用' : (r.status === 2 ? '锁定' : '禁用');
  if ('gender' in r) r.genderText = r.gender === 1 ? '男' : (r.gender === 2 ? '女' : '—');
  if ('type' in r) {
    if (page.id === 'role') r.typeText = r.type === 1 ? '内置' : '自定义';
    else if (page.id === 'menu') r.typeText = r.type === 1 ? '目录' : (r.type === 2 ? '菜单' : '按钮');
    else if (page.id === 'api') r.typeText = r.type === 'catalog' ? '目录' : '接口';
  }
  if ('data_scope' in r) { const d = saDATA_SCOPE.find(x => x.value === r.data_scope); r.dataScopeText = d ? d.label : '—'; }
  if (page.id === 'role') r.userCount = (r.users || []).length;
  if (page.id === 'dict') r.itemCount = (r.items || '').split('\n').filter(Boolean).length;
  return r;
}

/* ============================================================ 状态与渲染 ============================================================ */
let saCurrent = 'org';
const saData = {};          // id -> 行数组（可增删改）
const saView = { page: 1, pageSize: 10, filters: {} };

function saEnsureData(id) { if (!saData[id]) saData[id] = saPAGES[id].sample.map(r => Object.assign({}, r)); return saData[id]; }

function saRenderContent() {
  const p = saPAGES[saCurrent];
  const rows = saEnsureData(saCurrent).map(r => saDecorate(p, r));
  const filtered = rows.filter(r => {
    return Object.keys(saView.filters).every(k => {
      const f = (p.filters || []).find(x => x.key === k); if (!f) return true;
      const v = saView.filters[k]; if (v === '' || v == null) return true;
      const cell = r[k];
      if (f.type === 'select') return String(cell) === String(v);
      return String(cell == null ? '' : cell).toLowerCase().includes(String(v).toLowerCase());
    });
  });
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / saView.pageSize));
  if (saView.page > pages) saView.page = pages;
  const start = (saView.page - 1) * saView.pageSize;
  const slice = filtered.slice(start, start + saView.pageSize);

  const filterHtml = (p.filters || []).length ? saBuildFilterCard(p) : '';
  const tableHtml = saBuildTable(p, slice);
  const pagerHtml = saBuildPager(total, start, slice.length);
  $('#sa-content').innerHTML = filterHtml + tableHtml + pagerHtml;

  saBindFilters(p);
  saBindPager();
  saBindRowActions(p);
}

function saBuildFilterCard(p) {
  let fields = '<div class="form-grid">';
  (p.filters || []).forEach(f => { fields += '<div class="col-' + (f.col || 4) + '">' + saFieldHTML(f, {}, 'filter') + '</div>'; });
  fields += '</div>';
  return '<div class="filter-card"><div class="fc-body">' + fields + '</div>' +
    '<div class="fc-actions"><button class="btn btn-outline btn-sm" id="fc-reset">重置</button>' +
    '<button class="btn btn-primary btn-sm" id="fc-search">' + icon('search', 'ic-sm') + ' 查询</button></div></div>';
}
function saFieldHTML(f, row, mode) {
  const val = row[f.key];
  const lbl = mode === 'filter' ? f.label : (f.label + (f.required ? '<span class="required">*</span>' : ''));
  if (mode === 'detail') {
    if (f.type === 'tree') return '';
    let v = val;
    if (f.type === 'switch') v = (val === 1 || val === true) ? '启用' : '禁用';
    else if (f.type === 'select') { const o = (f.options || []).find(x => String(x.value) === String(val)); v = o ? o.label : (val || '—'); }
    return '<div class="ro-field"><span class="ro-k">' + esc(f.label) + '</span><span class="ro-v">' + esc(v == null || v === '' ? '—' : v) + '</span></div>';
  }
  let ctrl;
  if (f.type === 'switch') {
    const on = (val === 1 || val === true) ? 'checked' : '';
    ctrl = '<label class="switch"><input type="checkbox" data-key="' + f.key + '" ' + on + '><span class="track"></span><span>' + (on ? '启用' : '禁用') + '</span></label>';
  } else if (f.type === 'select') {
    let opts = '<option value="">请选择</option>';
    (f.options || []).forEach(o => { opts += '<option value="' + esc(o.value) + '"' + (String(val) === String(o.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; });
    ctrl = '<select class="input" data-key="' + f.key + '">' + opts + '</select>';
  } else if (f.type === 'textarea') {
    ctrl = '<textarea class="input" data-key="' + f.key + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(val || '') + '</textarea>';
  } else if (f.type === 'tree') {
    ctrl = saBuildPermTree(val || []);
  } else {
    const t = f.type === 'number' ? 'type="number"' : 'type="text"';
    ctrl = '<input class="input" ' + t + ' data-key="' + f.key + '" value="' + esc(val || '') + '" placeholder="' + esc(f.placeholder || '') + '">';
  }
  return '<div class="col-' + (f.col || 6) + '"><label class="field-label">' + lbl + '</label>' + ctrl + '</div>';
}
function saBuildPermTree(checked) {
  function node(n) {
    const has = checked.includes(n.id);
    let h = '<li><label><input type="checkbox" class="pt-cb" value="' + n.id + '"' + (has ? ' checked' : '') + '> ' + esc(n.name) + '</label>';
    if (n.children) { h += '<ul>' + n.children.map(node).join('') + '</ul>'; }
    return h + '</li>';
  }
  return '<div class="perm-tree"><ul>' + saMENU_TREE.map(node).join('') + '</ul></div>';
}
function saBuildTable(p, rows) {
  let head = '<tr>' + p.columns.map(c => '<th>' + esc(c.label) + '</th>').join('') + (p.readonly ? '<th>操作</th>' : '<th>操作</th>') + '</tr>';
  let body = '';
  if (!rows.length) {
    body = '<tr><td class="empty" colspan="' + (p.columns.length + 1) + '">暂无数据</td></tr>';
  } else {
    rows.forEach(r => {
      const actions = p.readonly
        ? '<button class="link-btn" data-act="detail" data-id="' + r.id + '">详情</button>'
        : '<button class="link-btn" data-act="detail" data-id="' + r.id + '">' + icon('eye', 'ic-xs') + ' 详情</button>' +
          '<button class="link-btn" data-act="edit" data-id="' + r.id + '">' + icon('edit', 'ic-xs') + ' 编辑</button>' +
          '<button class="link-btn danger" data-act="delete" data-id="' + r.id + '">' + icon('trash', 'ic-xs') + ' 删除</button>';
      body += '<tr>' + p.columns.map(c => saCellFor(c, r)).join('') + '<td><div class="row-actions">' + actions + '</div></td></tr>';
    });
  }
  return '<div class="table-wrap"><div class="table-scroll"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></div>';
}
function saStatusCls(s) { return s === 1 ? 'success' : (s === 2 ? 'warning' : 'muted'); }
function saCellFor(c, r) {
  if (c.status) return '<td><span class="badge-status ' + saStatusCls(r.status) + '"><span class="dot"></span>' + esc(r[c.key]) + '</span></td>';
  let v = r[c.key]; if (v == null || v === '') v = '—';
  return '<td>' + esc(v) + '</td>';
}
function saBuildPager(total, start, count) {
  const pages = Math.max(1, Math.ceil(total / saView.pageSize));
  let nums = '';
  const cur = saView.page;
  const range = [];
  if (pages <= 7) { for (let i = 1; i <= pages; i++) range.push(i); }
  else {
    range.push(1); if (cur > 3) range.push('...');
    for (let i = Math.max(2, cur - 1); i <= Math.min(pages - 1, cur + 1); i++) range.push(i);
    if (cur < pages - 2) range.push('...'); range.push(pages);
  }
  range.forEach(i => { nums += i === '...' ? '<span class="pager-ellipsis">…</span>' : '<button class="pager-btn' + (i === cur ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>'; });
  return '<div class="pager"><div class="pager-info">共 <b>' + total + '</b> 条，当前 ' + (total ? (start + 1) + '-' + (start + count) : '0') + '</div>' +
    '<div class="pager-controls">' +
    '<button class="pager-btn" data-page="prev"' + (cur <= 1 ? ' disabled' : '') + '>上一页</button>' + nums +
    '<button class="pager-btn" data-page="next"' + (cur >= pages ? ' disabled' : '') + '>下一页</button></div>' +
    '<div class="pager-size"><label>每页</label><select id="page-size">' + [10, 20, 50].map(n => '<option value="' + n + '"' + (n === saView.pageSize ? ' selected' : '') + '>' + n + ' 条</option>').join('') + '</select></div></div>';
}

/* 绑定 */
function saBindFilters(p) {
  if (!p.filters || !p.filters.length) return;
  const fc = $('#sa-content .filter-card'); if (!fc) return;
  (p.filters || []).forEach(f => { const el = fc.querySelector('[data-key="' + f.key + '"]'); if (el) el.value = saView.filters[f.key] != null ? saView.filters[f.key] : ''; });
  $('#fc-search').addEventListener('click', () => {
    saView.filters = {}; (p.filters || []).forEach(f => { const el = fc.querySelector('[data-key="' + f.key + '"]'); if (el) saView.filters[f.key] = el.value; });
    saView.page = 1; saRenderContent();
  });
  $('#fc-reset').addEventListener('click', () => { saView.filters = {}; saRenderContent(); });
}
function saBindPager() {
  const c = $('#sa-content .pager'); if (!c) return;
  c.querySelectorAll('.pager-btn').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.page; const pages = Math.max(1, Math.ceil(saCurrentRowsTotal() / saView.pageSize));
    if (t === 'prev') saView.page = Math.max(1, saView.page - 1);
    else if (t === 'next') saView.page = Math.min(pages, saView.page + 1);
    else saView.page = Number(t);
    saRenderContent();
  }));
  const ps = $('#page-size'); if (ps) ps.addEventListener('change', () => { saView.pageSize = Number(ps.value); saView.page = 1; saRenderContent(); });
}
function saCurrentRowsTotal() {
  const p = saPAGES[saCurrent]; const rows = saEnsureData(saCurrent).map(r => saDecorate(p, r));
  return rows.filter(r => Object.keys(saView.filters).every(k => {
    const f = (p.filters || []).find(x => x.key === k); if (!f) return true; const v = saView.filters[k]; if (v === '' || v == null) return true;
    const cell = r[k]; if (f.type === 'select') return String(cell) === String(v);
    return String(cell == null ? '' : cell).toLowerCase().includes(String(v).toLowerCase());
  })).length;
}
function saBindRowActions(p) {
  $all('#sa-content [data-act]').forEach(b => b.addEventListener('click', () => {
    const id = Number(b.dataset.id); const row = saEnsureData(saCurrent).find(r => r.id === id);
    if (!row) return;
    if (b.dataset.act === 'detail') saOpenDetail(row);
    else if (b.dataset.act === 'edit') saOpenForm('edit', row);
    else if (b.dataset.act === 'delete') saAskDelete(row);
  }));
}

/* ============================================================ 抽屉：新建 / 编辑 / 详情 ============================================================ */
function saOpenForm(mode, row) {
  const p = saPAGES[saCurrent]; const isEdit = mode === 'edit';
  $('#sa-sheet-title').textContent = (isEdit ? '编辑' : '新建') + ' · ' + p.title;
  let body = '<div class="form-grid">';
  p.form.forEach(f => { body += saFieldHTML(f, row || {}, 'form'); });
  body += '</div>';
  if (p.id === 'role' && p.customDetail) { /* 编辑态不显示只读摘要 */ }
  $('#sa-sheet-body').innerHTML = body;
  if (p.id === 'role' && p.customDetail) { /* 编辑态不显示只读摘要 */ }
  $('#sa-sheet-footer').innerHTML = '<button class="btn btn-outline" id="sa-sheet-cancel">取消</button><button class="btn btn-primary" id="sa-sheet-save">' + (isEdit ? '保存' : '创建') + '</button>';
  saOpenSheet();
  $('#sa-sheet-cancel').addEventListener('click', saCloseSheet);
  $('#sa-sheet-save').addEventListener('click', () => saSaveForm(p, isEdit, row));
}
function saOpenDetail(row) {
  const p = saPAGES[saCurrent]; const r = saDecorate(p, row);
  $('#sa-sheet-title').textContent = '详情 · ' + p.title;
  let body = '<div class="form-grid">';
  p.form.forEach(f => { body += saFieldHTML(f, r, 'detail'); });
  body += '</div>';
  if (p.customDetail) body += p.customDetail(r);
  $('#sa-sheet-body').innerHTML = body;
  $('#sa-sheet-footer').innerHTML = p.readonly ? '<button class="btn btn-outline" id="sa-sheet-cancel">关闭</button>' : '<button class="btn btn-outline" id="sa-sheet-cancel">关闭</button><button class="btn btn-primary" id="sa-sheet-edit">编辑</button>';
  saOpenSheet();
  $('#sa-sheet-cancel').addEventListener('click', saCloseSheet);
  if (!p.readonly) $('#sa-sheet-edit').addEventListener('click', () => saOpenForm('edit', row));
}
function saSaveForm(p, isEdit, row) {
  const data = {};
  let ok = true;
  p.form.forEach(f => {
    if (f.type === 'tree') {
      data[f.key] = $all('#sa-sheet-body .pt-cb:checked').map(c => c.value);
    } else {
      const el = $('#sa-sheet-body [data-key="' + f.key + '"]');
      if (!el) return;
      let v = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value.trim();
      if (f.type === 'number') v = v === '' ? '' : Number(v);
      else if (f.type === 'select' && f.options && typeof f.options[0].value === 'number' && v !== '') v = Number(v);
      if (f.required && (v === '' || v == null)) { ok = false; el.style.borderColor = 'hsl(var(--destructive))'; }
      data[f.key] = v;
    }
  });
  if (!ok) { saToast('请填写必填项'); return; }
  const store = saEnsureData(saCurrent);
  if (isEdit) { Object.assign(row, data); saToast('已保存'); }
  else { data.id = Math.max(0, ...store.map(r => r.id)) + 1; store.unshift(data); saToast('已创建'); }
  saCloseSheet(); saRenderContent();
}
function saOpenSheet() { $('#sa-sheet-overlay').classList.add('open'); $('#sa-sheet-panel').classList.add('open'); }
function saCloseSheet() { $('#sa-sheet-overlay').classList.remove('open'); $('#sa-sheet-panel').classList.remove('open'); }

/* 轻提示（持久 #sa-toast，避免与门户 #toast 冲突） */
let saToastTimer = null;
function saToast(msg) {
  const t = document.getElementById('sa-toast'); if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  if (saToastTimer) clearTimeout(saToastTimer);
  saToastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000);
}

/* 删除确认 */
let saPendingDelete = null;
function saAskDelete(row) {
  const p = saPAGES[saCurrent];
  if (p.id === 'user' && row.is_tenant_admin === 1) { saToast('租户管理员不可删除'); return; }
  saPendingDelete = row;
  $('#sa-confirm-text').textContent = '确定要删除「' + (row.name || row.username || row.code || row.title || '该记录') + '」吗？此操作不可撤销。';
  $('#sa-confirm-overlay').classList.add('open');
}
$('#sa-confirm-ok').addEventListener('click', () => {
  if (saPendingDelete) { const store = saEnsureData(saCurrent); const i = store.indexOf(saPendingDelete); if (i >= 0) store.splice(i, 1); saToast('已删除'); }
  saPendingDelete = null; $('#sa-confirm-overlay').classList.remove('open'); saRenderContent();
});
$('#sa-confirm-cancel').addEventListener('click', () => { saPendingDelete = null; $('#sa-confirm-overlay').classList.remove('open'); });
Object.keys(saPAGES).forEach(function (k) { saPAGES[k].id = k; });

function saSelectPage(id) { saCurrent = id; saView.page = 1; saView.pageSize = 10; saView.filters = {}; saRenderContent(); }
(function bindSaDrawers() {
  const ov = $('#sa-sheet-overlay'); if (ov) ov.addEventListener('click', saCloseSheet);
  const cl = $('#sa-sheet-close'); if (cl) { cl.innerHTML = icon('x', 'ic-sm'); cl.addEventListener('click', saCloseSheet); }
})();
