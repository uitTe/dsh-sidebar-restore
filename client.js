/**
 * 侧边栏图标轨道。
 *
 * Windows 桌面端（html[data-windows-titlebar]）收起侧栏时，布局把首列轨道算成 0px，
 * 整列消失；侧栏又把面板列表、工作区区域、底部区域整段 display:none，
 * 新建会话按钮被改成 position:fixed 飘到标题栏里，品牌行被压成 0 高。
 * 本插件把首列还原成 56px 图标竖条，让这几块内容在收起态仍然可见，
 * 把图标在轨道内水平居中，把新建会话按钮移回轨道顶部，并在它上方加上 DSH 标志。
 * 展开／收起的开关留在宿主原本的标题栏位置。
 *
 * 轨道里另加一个工作区入口：文件夹图标排在搜索盒之上，悬停时把宿主的侧栏展开，
 * 只把工作区区域浮到轨道右侧作为卡片，其余部分仍按轨道排布。
 *
 * 悬浮期间为什么要把宿主的收起类名补回根容器：
 * 宿主用 `wide` 决定根容器的类名，宽度一开就换成宽态那一套——图标变成 28px、
 * 文字重新出现、新建会话与底部区域全部换装。逐条覆盖这些样式每漏一条就是一次跳变，
 * 所以这里改成让宿主的收起类名继续在场，收起态的整份规则继续生效，
 * 插件自己的覆盖只兜住宽度这类必须改的量。
 *
 * 标志用宿主前端产物里已有的 favicon.svg 做遮罩；图形由 CSS 生成，不往宿主容器里插节点。
 *
 * 动画为什么不用列宽过渡：
 * 宿主的收起／展开是 `transition: grid-template-columns`。这个属性每帧都要重新分配
 * 三列宽度，并把两侧列内全部内容重新排版，帧的成本很高；时长拉得越长、要跑的帧越多，
 * 卡顿越明显。这里改成两步：
 *  1. 列宽当场跳到终值，写入的那一帧临时关掉外框过渡，浏览器只做一次布局；
 *  2. 用 transform 把中栏从旧位置滑到终点，只走合成层，不触发任何布局。
 * 时长与阻尼曲线都作用在这条 transform 上，因此可以放心拉长到 460ms 并带轻微越冲。
 */
window.__ModuleLoader__.load({
  id: '@uitte/dsh-sidebar-restore',
  factory() {
    /** 收起后的轨道宽度，与 Web 版 56px 轨道一致。 */
    const RAIL = 56;
    const RAIL_TRACK = `${RAIL}px`;
    /** 展开态侧栏宽度的初值：插件挂载时若已收起，就用这个估计滑动距离。 */
    const DEFAULT_EXPANDED = 280;
    /** 轨道内图标的按钮边长。 */
    const BUTTON = 36;
    /** 轨道内图标本身的边长，与宿主面板图标的 18px 一致。 */
    const ICON = 18;
    /** favicon 的 50 × 50 画布里，鲸鱼墨迹占 48.84 × 36.63。 */
    const FISH_W = 48.84;
    const FISH_H = 36.63;
    /** 标志盒宽度与其它图标盒子同宽。 */
    const LOGO_W = ICON;
    /** 盒高与面板行的按钮高度一致，鲸鱼墨迹在盒内垂直居中。 */
    const LOGO_H = BUTTON;
    /**
     * 遮罩画布缩放：让 50 × 50 画布里的鲸鱼墨迹正好 18px 宽。
     * 等比缩放，鲸鱼墨迹随之 18 × 13.5，在 36px 的盒子里上下各留 11.25px。
     */
    const LOGO_MASK = Number(((LOGO_W * 50) / FISH_W).toFixed(2));
    /** 滑动的时长。作用在 transform 上，不产生布局。 */
    const SLIDE_MS = 460;
    /** 阻尼曲线：后段越过终点再回落，收尾带回弹。 */
    const SLIDE_EASING = "cubic-bezier(0.32, 1.24, 0.46, 1)";
    /** 产品标志：前端产物里已有的 favicon.svg，与侧栏品牌行同一个鲸鱼图形。 */
    const LOGO_URL = 'url("./favicon.svg")';
    /** 工作区卡片的宽度，与展开态侧栏同宽。 */
    const FLYOUT_W = 280;
    /** 指针离开入口与卡片后收起卡片的延迟。 */
    const FLYOUT_LINGER_MS = 180;
    /** 宿主 folder-close 图标的路径，16 × 16 画布。 */
    const FOLDER_PATH =
      "M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z";
    /** 收起态、悬浮态与收起过渡态共用的轨道选择器。 */
    const RAIL_STATE = ':is([data-sidebar-collapsed="true"], [data-rail-flyout], [data-rail-settling])';

    const CSS = `
      /* 写入列宽的那一帧不跑宿主的列宽过渡 */
      [data-rail-instant] {
        transition: none !important;
      }

      /* 悬浮卡片开合期间冻结外框列宽与侧栏动画，中栏位置保持不变。
         只限制布局外框和侧栏子树，避免影响主内容里的加载与打字动画。 */
      :is([data-rail-flyout], [data-rail-settling]) {
        transition: none !important;
      }
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_centerCol"] {
        transition: none !important;
      }
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"],
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] * {
        transition: none !important;
        animation: none !important;
      }
      /* 过渡期间侧栏内容保持不透明，宿主重挂类名不会带出淡出 */
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_fading"] > *,
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] {
        opacity: 1 !important;
      }

      /* 宿主在轨道入场与宽态淡出时播 rail-in / wide-in / fading 三组动画，
         关键帧都从 opacity: 0 起，图标会整列透明再浮现；卡片开合会来回切这两组类名，
         表现为所有图标闪一下。轨道内直接中和这三组动画的起点状态。 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_railIn"] [class*="_iconButton"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_railIn"] [class*="_newSession"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_railIn"] [class*="_panelList"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_railIn"] [class*="_regionArea"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_railIn"] [class*="_footArea"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_wide"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_fading"] > * {
        animation: none !important;
        opacity: 1 !important;
        transform: none !important;
      }

      /* 普通侧栏开合期间把中栏提升到合成层，transform 逐帧只做合成 */
      [data-rail-slide] [class*="_centerCol"] {
        will-change: transform;
      }

      /* 轨道容器：去掉左右内边距，改由子元素各自居中。
         侧栏由 slot 挂载，根元素是槽位容器的直接子节点；用槽位属性限定，
         才不会波及面板列表里那些来自其它包、同样以 _root 结尾的元素。 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] {
        padding: 8px 0 6px !important;
        align-items: center !important;
        width: ${RAIL}px !important;
        min-width: ${RAIL}px !important;
        max-width: ${RAIL}px !important;
      }

      /* 轨道顶部的产品标志：盒宽与面板图标同宽，盒高与面板按钮同高。
         用宿主 favicon.svg 做遮罩，颜色取主题令牌，深浅色自动跟随。
         favicon 是 50 × 50 画布，鲸鱼墨迹占 48.84 × 36.63；遮罩等比放大到
         18.43px，鲸鱼墨迹正好 18px 宽、13.5px 高，在 36px 的盒子里上下各留 11.25px。 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"]::before {
        content: "" !important;
        display: block !important;
        flex: none !important;
        box-sizing: border-box !important;
        width: ${LOGO_W}px !important;
        height: ${LOGO_H}px !important;
        margin: 0 auto !important;
        background-color: var(--dsw-alias-label-primary) !important;
        -webkit-mask-image: ${LOGO_URL} !important;
        mask-image: ${LOGO_URL} !important;
        -webkit-mask-repeat: no-repeat !important;
        mask-repeat: no-repeat !important;
        -webkit-mask-position: center !important;
        mask-position: center !important;
        -webkit-mask-size: ${LOGO_MASK}px ${LOGO_MASK}px !important;
        mask-size: ${LOGO_MASK}px ${LOGO_MASK}px !important;
        pointer-events: none !important;
      }

      /* 品牌行塌陷：开关固定在标题栏里，这一行不占高度 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_logoRow"] {
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* 新建会话：从标题栏移回轨道顶部，固定尺寸并居中。
         宽态给按钮带上了底色与细边框，轨道里退回无底色无边框。 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] button[class*="_newSession"] {
        position: static !important;
        left: auto !important;
        top: auto !important;
        align-self: center !important;
        width: ${BUTTON}px !important;
        height: ${BUTTON}px !important;
        margin: 0 !important;
        padding: 0 !important;
        justify-content: center !important;
        align-items: center !important;
        background: transparent !important;
        border-color: transparent !important;
        border-radius: var(--dsw-radius-md) !important;
      }

      /* 轨道里图标之间不留间隔：宿主收起态给面板列表设了 12px 行距，新建会话与面板列表
         之间也有 12px，这里一律归零，竖条按等距排布 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_panelList"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_footArea"] {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        width: 100% !important;
        gap: 0 !important;
        row-gap: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        margin-bottom: 0 !important;
        padding-left: 0 !important;
      }

      /* 轨道里没有工作区内容，这一段不占排布：宿主收起态同样整段隐藏，
         留着 flex:1 会在卡片浮起时把底部两行顶上去，开合各跳一次 */
      html[data-windows-titlebar] ${RAIL_STATE}:not([data-rail-flyout]) > [class*="_sidebarCol"] [class*="_regionArea"] {
        display: none !important;
      }

      /* 底部两行（设置与插件动作）各自居中 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_settingsArea"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_footerActions"] {
        justify-content: center !important;
        align-items: center !important;
        width: 100% !important;
      }

      /* 底部两行的内层由各自插件按宽态渲染：设置行撑成 42px 整行并带「设置」文字，
         头像按钮撑成 44px 整行并带用户名，插件动作行撑成 42px 徽标行并带数量。
         轨道里只留 36px 方形按钮，文字与状态指示一并隐藏。
         这些类名带构建哈希，按结构定位：设置行是 triggerRow，设置按钮没有
         data-collapsed，头像按钮带 data-collapsed；状态指示是 triggerRow 的后续兄弟。 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_settingsArea"] [class*="_triggerRow"] {
        width: ${BUTTON}px !important;
        margin: 8px 0 10px !important;
        gap: 0 !important;
        justify-content: center !important;
        align-items: center !important;
      }

      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_settingsArea"] [class*="_triggerRow"] > :not(:first-child) {
        display: none !important;
      }

      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_settingsArea"] button[class*="_trigger"] {
        flex: none !important;
        width: ${BUTTON}px !important;
        height: ${BUTTON}px !important;
        margin: 0 !important;
        padding: 0 !important;
        gap: 0 !important;
        border-inline: 0 !important;
        justify-content: center !important;
        align-items: center !important;
      }

      /* 头像行的根容器宽态左右各缩进 2px，退回贴边 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_settingsArea"] [class*="_triggerRow"] [class*="_root"] {
        margin-inline: 0 !important;
      }

      /* 头像按钮同样带 data-collapsed，不能再按该属性排除 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_settingsArea"] button[class*="_trigger"] svg {
        width: ${ICON}px !important;
        height: ${ICON}px !important;
        flex: none !important;
      }

      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_settingsArea"] [class*="_triggerLabel"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_settingsArea"] [class*="_label"]:not([class*="_newSessionLabel"]):not([class*="_badgeLabel"]) {
        display: none !important;
      }

      /* 插件动作行：宽态是整行徽标，退回 36px 圆形按钮 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_footerActions"] [class*="_layer"] {
        width: ${BUTTON}px !important;
        height: ${BUTTON}px !important;
        margin: 0 !important;
      }

      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_footerActions"] [class*="_footerButtons"] {
        flex-direction: column !important;
        gap: 2px !important;
      }

      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_footerActions"] [class*="_badge"]:not([class*="_badgeLabel"]):not([class*="_badgeCount"]) {
        width: ${BUTTON}px !important;
        height: ${BUTTON}px !important;
        margin: 0 !important;
        padding: 0 !important;
        gap: 0 !important;
        border-radius: 50% !important;
        justify-content: center !important;
        align-items: center !important;
      }

      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_footerActions"] [class*="_badge"] svg {
        width: ${ICON}px !important;
        height: ${ICON}px !important;
        flex: none !important;
      }

      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_footerActions"] [class*="_badgeLabel"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_footerActions"] [class*="_badgeCount"] {
        display: none !important;
      }

      /* 面板行与「更多」行：固定为方形按钮，图标居中 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_panelRow"] {
        width: ${BUTTON}px !important;
        height: ${BUTTON}px !important;
        margin: 0 auto !important;
        padding: 0 !important;
        justify-content: center !important;
        align-items: center !important;
        border-inline: 0 !important;
      }

      /* 面板行内的图标容器本身也居中 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_panelGlyph"] {
        justify-content: center !important;
        align-items: center !important;
      }

      /* 图标尺寸：宿主按宽态／轨道态传 16 与 18（新建会话传 14 与 16），
         卡片展开期间会整体缩小一圈。这里钉回轨道态的尺寸。
         图标由槽位渲染，中间可能隔着 display:contents 的容器，用后代选择器。 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_panelGlyph"] svg {
        width: ${ICON}px !important;
        height: ${ICON}px !important;
        flex: none !important;
      }

      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] button[class*="_newSession"] [class*="_newSessionContent"] svg {
        width: ${ICON - 2}px !important;
        height: ${ICON - 2}px !important;
        flex: none !important;
      }

      /* 轨道态只留图标：卡片展开期间宿主是宽态，会把面板标题、新建会话标签与
         品牌名渲染出来，这些文字在 56px 的竖条里放不下，一并隐藏。
         匹配时排除更长的同前缀类名：_newSessionLabel 会连带命中
         newSessionLabelMask，而图标与标签都包在那层里，隐藏它会把图标一起吃掉。 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_panelTitle"]:not([class*="_panelTitleBlock"]),
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_newSessionLabel"]:not([class*="_newSessionLabelMask"]),
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_newSessionShortcut"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_brandName"]:not([class*="_brandNameMask"]) {
        display: none !important;
      }

      /* 新建会话按钮在宽态会按标签宽度撑开，退回固定方形 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] button[class*="_newSession"] [class*="_newSessionContent"] {
        width: ${BUTTON}px !important;
        gap: 0 !important;
        justify-content: center !important;
      }

      /* 工作区浏览区：标题行、搜索按钮与列表在轨道内居中 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_sectionHeader"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_headerActions"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_listArea"],
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_treeBody"] {
        justify-content: center !important;
        align-items: center !important;
        margin-left: auto !important;
        margin-right: auto !important;
        padding-left: 0 !important;
      }

      /* 搜索盒子：轨道里由工作区入口顶替。它紧跟在入口按钮之后，位置已经由按钮接管，
         所以整段收起不占位。卡片展开时不适用（:not 排除）：卡片里要留着宿主原装的
         工作区搜索，1.0.9 应 Su 要求恢复；按钮尺寸同理，卡片里保持宿主宽态的 28px。
         用「直接包含搜索按钮」定位这个盒子，避开同前缀的 searchButton / searchSlot / searchInput。
         data-rail-workspace 打在 html 自身，属性选择器直接写在 html 上。 */
      html[data-windows-titlebar][data-rail-workspace] ${RAIL_STATE}:not([data-rail-flyout]) > [class*="_sidebarCol"] div:has(> button[class*="_searchButton"]) {
        display: none !important;
      }

      html[data-windows-titlebar] ${RAIL_STATE}:not([data-rail-flyout]) > [class*="_sidebarCol"] button[class*="_searchButton"] {
        width: ${BUTTON}px !important;
        height: ${BUTTON}px !important;
        margin: 0 !important;
        padding: 0 !important;
        justify-content: center !important;
        align-items: center !important;
      }

      /* 搜索盒与标题行之间的空白：轨道里标题行没有内容，整行高度归零 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_sectionHeader"] {
        height: 0 !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        gap: 0 !important;
      }

      /* 工作区根容器：隔着槽位容器，按层级写全；去掉内边距与行距，
         轨道内各元素按 36px 步长相接 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_regionArea"] [data-slot] > [class*="_root"] {
        padding: 0 !important;
        row-gap: 0 !important;
        gap: 0 !important;
      }

      /* 工作区入口：文件夹按钮。由脚本插到侧栏根容器里、工作区区域之前，
         因此和面板图标一样参与正常布局，不会被定位到侧栏之外 */
      [data-rail-workspace-button] {
        display: none;
        flex: none;
        width: ${BUTTON}px;
        height: ${BUTTON}px;
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        border: none;
        border-radius: var(--dsw-radius-md);
        background: transparent;
        color: var(--dsw-alias-label-primary);
        cursor: pointer;
        appearance: none;
        justify-content: center;
        align-items: center;
      }

      html[data-rail-workspace] [data-rail-workspace-button] {
        display: inline-flex;
      }

      [data-rail-workspace-button] svg {
        width: ${ICON}px;
        height: ${ICON}px;
        display: block;
        flex: none;
      }

      @media (hover: hover) {
        [data-rail-workspace-button]:hover {
          background-color: var(--dsw-alias-interactive-bg-hover);
        }
      }

      /* 悬浮态：侧栏列与根容器都让出溢出，工作区区域才能浮到轨道右侧。
         根容器保持 56px 宽，卡片以它为基准定位；宿主此时是展开态，会把根撑到 280px，
         这里按轨道宽度收回来，否则轨道图标会被拉宽。 */
      [data-rail-flyout] > [class*="_sidebarCol"] {
        overflow: visible !important;
        border-right: none !important;
      }

      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] {
        position: relative !important;
        width: ${RAIL}px !important;
        overflow: visible !important;
        /* 分隔线改挂在根容器上：侧栏列的右边框会被 56px 宽的根容器
           背景盖住，根容器自己的边框画在上层，卡片展开时右缘不秃 */
        border-right: 0.5px solid var(--dsw-alias-border-l3) !important;
      }

      /* 工作区卡片独立于侧栏：脱离流式排布，从文件夹入口右侧展开，
         上下各留一段边距，圆角与阴影表明它是浮层而不是侧栏的一部分。
         _regionArea 是根容器里 _scrollRegion > _scrollArea 的深度后代，
         最后一段只能用后代组合子，写成子组合子永远匹配不到；
         组合子不计特异性，这样改过后特异性与原来一致，
         仍高于上方轨道态的 100% 宽度规则。 */
      [data-rail-flyout] > [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] [class*="_regionArea"] {
        display: flex !important;
        position: absolute !important;
        left: ${RAIL}px !important;
        top: var(--rail-flyout-top, 8px) !important;
        bottom: auto !important;
        width: ${FLYOUT_W}px !important;
        min-width: ${FLYOUT_W}px !important;
        max-height: calc(100% - var(--rail-flyout-top, 8px) - 12px) !important;
        margin: 0 !important;
        padding: 8px !important;
        box-sizing: border-box !important;
        z-index: 80 !important;
        overflow: hidden !important;
        align-items: stretch !important;
        background: var(--dsw-specific-sidebar-fill) !important;
        border-radius: var(--dsw-radius-md) !important;
        box-shadow: 0 8px 32px #0000002e !important;
      }

      /* 收起过渡时移除工作区区域的排布空间，避免列表闪进轨道或挤动图标 */
      html[data-windows-titlebar] [data-rail-settling] > [class*="_sidebarCol"] [class*="_regionArea"] {
        display: none !important;
      }

      /* 卡片脱离排布后，底部行靠自动外边距留在轨道底部，其余图标位置不变 */
      [data-rail-flyout] > [class*="_sidebarCol"] [class*="_footArea"] {
        margin-top: auto !important;
      }

      /* 卡片里的内容恢复展开态排布：不再套用轨道内的居中与零间距。
         这两条必须带 html[data-windows-titlebar] 前缀：轨道居中规则写的是
         html 前缀 + RAIL_STATE（RAIL_STATE 含 data-rail-flyout），特异性 (0,4,1)，
         不带前缀的展开规则只有 (0,4,0)，同为 !important 时反被轨道规则压住——
         列表在卡片里仍按内容收缩居中，会话行按最大内容宽度排布，
         行尾时间被挤出卡片右缘、按字形一半硬切（1.0.7 修复）。 */
      html[data-windows-titlebar] [data-rail-flyout] > [class*="_sidebarCol"] [class*="_regionArea"] [class*="_sectionHeader"] {
        height: auto !important;
        min-height: 36px !important;
        margin: 0 0 8px !important;
        padding: 0 4px !important;
        justify-content: flex-start !important;
        /* 轨道规则把标题行 gap 归零过，卡片里恢复宿主的 4px，
           否则搜索与操作组会贴在一起（1.0.10 补） */
        gap: 4px !important;
      }

      /* 标题行里的操作按钮组同理（1.0.10）：轨道居中规则的选择器列表里也
         带着 _headerActions，1.0.7 只恢复了标题行本身，漏了它——它在卡片里
         仍带着 margin-left/right: auto，与搜索槽自带的 margin-left: auto
         瓜分标题行的剩余空间，搜索按钮与操作组之间被撑出约 30px 的空档
         （停靠态两者只隔 4px），操作组右缘也离卡片右缘差了同样一段。
         在卡片里把它的边距归零、内容靠左，三个图标恢复均匀相接。 */
      html[data-windows-titlebar] [data-rail-flyout] > [class*="_sidebarCol"] [class*="_regionArea"] [class*="_headerActions"] {
        justify-content: flex-start !important;
        align-items: center !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        padding-left: 0 !important;
      }

      html[data-windows-titlebar] [data-rail-flyout] > [class*="_sidebarCol"] [class*="_regionArea"] [class*="_listArea"],
      html[data-windows-titlebar] [data-rail-flyout] > [class*="_sidebarCol"] [class*="_regionArea"] [class*="_treeBody"] {
        justify-content: flex-start !important;
        align-items: stretch !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        padding-left: 0 !important;
      }

      /* 列表过长时卡片内滚动（1.0.8）：工作区根容器在宿主宽态按
         max-height: 100cqh 定高，上限是整列高度而不是卡片高度，于是它比
         卡片还高出一截，列表的滚动行程按这个错误高度计算，滚到底仍有
         最后几行被卡片下缘切掉、永远够不着。槽位容器是 display:contents，
         根容器实际就是卡片（纵向 flex）的直接子项，改由 flex 撑满卡片
         内容高度，列表高度随之正确，滚动行程完整。
         列表本身再钉死为滚动容器：宿主有一条 @container scroll-state
         规则会在「外层还能向下滚」时把列表的 overflow-y 关掉，那是停靠
         布局的嵌套滚动编排，浮卡片里不适用；滚到尽头也不向外层链式滚动。 */
      html[data-windows-titlebar] [data-rail-flyout] > [class*="_sidebarCol"] [class*="_regionArea"] [data-slot] > [class*="_root"] {
        flex: 1 1 0% !important;
        min-height: 0 !important;
      }

      html[data-windows-titlebar] [data-rail-flyout] > [class*="_sidebarCol"] [class*="_regionArea"] [class*="_listArea"] {
        overflow-y: auto !important;
        overscroll-behavior: contain !important;
      }

      /* 卡片里的搜索盒不再隐藏（1.0.9）：1.0.0 时按「卡片只放会话列表」去掉，
         Su 实际使用后要求把工作区原装搜索放回卡片，与停靠侧栏一致。 */

      /* 侧栏收起或卡片过渡时，标题栏菜单起点保持不变 */
      html[data-windows-titlebar]:has([data-sidebar-collapsed="true"]),
      html[data-windows-titlebar]:has([data-rail-flyout]),
      html[data-windows-titlebar]:has([data-rail-settling]) {
        --dsh-windows-menu-start: 48px !important;
      }

      /* 轨道与中栏之间补回分隔线：宿主在顶栏分支去掉了侧栏右边框。
         卡片展开时也要保留，否则卡片上下方的轨道右缘会秃掉一段 */
      html[data-windows-titlebar] :is([data-sidebar-collapsed="true"], [data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] {
        border-right: 0.5px solid var(--dsw-alias-border-l3) !important;
      }

      /* 收起态的图标列要自上而下等距：宿主给新建会话行留了 12px 下边距，
         面板列因此比其余图标低一截，轨道里把这段边距去掉，
         标志、新建会话、面板与工作区入口回到同一 36px 节奏。
         侧栏开关在桌面端位于标题栏，品牌行里宿主自带的开关不属于轨道，
         一并隐藏，免得它压在标志与新建会话之间。 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_newSessionRow"] {
        margin-bottom: 0 !important;
      }

      /* 注意：品牌行里的 _toggle 不要隐藏。桌面端标题栏左上角那个
         收起/展开按钮就是这个元素（Web 壳里它落在侧栏顶部，桌面端被
         宿主摆进标题栏），轨道态下藏掉会让用户收起后再也展开不回来。
         1.0.2 曾在此误藏，1.0.4 已撤销。 */

      /* 卡片展开时宿主按宽态排版：滚动区被压成 0–10px 宽且 overflow hidden，
         区内的面板图标与工作区入口会被裁掉一截。展开与收尾期间解除这层挤压，
         内容按轨道列的实际宽度绘制。 */
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_scrollRegion"],
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_scrollArea"],
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_panelList"] {
        overflow: visible !important;
        width: auto !important;
        min-width: 0 !important;
        margin-left: 0 !important;
      }

      /* 宽态下每行行尾的「取消固定」按钮会落到面板图标上，轨道里不需要它 */
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_panelUnpin"] {
        display: none !important;
      }

      /* 卡片打开时图标列不该跳位：宽态给新建会话行与滚动区各留了几像素上边距，
         滚动区自身的网格第一行又是 8px 的间隔行，三处叠加把面板列整体推低。
         展开与收尾期间一并归零，面板列与收起轨道严丝合缝地对齐。 */
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_newSessionRow"] {
        margin-top: 0 !important;
      }

      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_scrollRegion"] {
        margin-top: 0 !important;
      }

      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_scrollArea"] {
        grid-template-rows: 0px max-content 2px max-content !important;
        /* 横向同理：首列 4px 间隔轨把面板列的中心推到 32px，
           比轨道中心线右移 4px，中间三个图标与上下不在一条垂线上，一并归零 */
        grid-template-columns: 0px 0px 6px !important;
      }

      /* 宽态品牌行会冒出一个 32×24 的品牌按钮（同为「新建会话」），
         压在标志与轨道的新建会话按钮之间叠印；收起轨道里根本没有它，
         展开/收尾期藏掉，只留轨道自己的新建会话按钮 */
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_logoRow"] [class*="_brand"] {
        display: none !important;
      }

      /* 新建会话按钮在宽态下多出左右各 1px 边框，内容盒缩到 34px，
         里面的标签遮罩是 flex 填充项跟着缩窄，居中后内容整体右移 1px，
         图标在展开卡片时就「动一下」。展开/收尾期把遮罩的 flex 基准
         钉回 36px（光改 width 会被 flex-basis 盖过），图标不再移位 */
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_newSessionLabelMask"] {
        flex: 0 0 36px !important;
        width: 36px !important;
      }

      /* 账户按钮在宽态下被设置区的左对齐排版带偏（实测 x 从 10 变 0），
         与工作区入口同样钉回轨道位置，纵向取轨道态实测值 --rail-account-top。
         它自带 8px 上边距（宿主 !important 规则，普通 margin:0 压不住），
         选择器特意叠高特异性把上边距归零，否则钉位会再往下错 8px */
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [data-slot="sidebar"] [class*="_settingsArea"] [class*="_triggerRow"][class*="_triggerRow"] {
        position: absolute !important;
        left: 10px !important;
        top: var(--rail-account-top, 848px) !important;
        margin-top: 0 !important;
        z-index: 70;
      }

      /* 工作区入口在展开态脱离滚动区的流式排布，钉回它在收起轨道里的位置：
         滚动区是它最近的定位祖先，改为静态后，入口与卡片都以侧栏根容器
         为定位基准（卡片的 left 本来就是按根容器写的）。
         纵向位置取收起态实测值 --rail-entry-top，由脚本在轨道态更新。 */
      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [class*="_scrollRegion"] {
        position: static !important;
      }

      :is([data-rail-flyout], [data-rail-settling]) > [class*="_sidebarCol"] [data-rail-workspace-button] {
        position: absolute !important;
        left: 10px !important;
        top: var(--rail-entry-top, 188px) !important;
        margin: 0 !important;
        z-index: 70 !important;
      }
    `;

    return {
      /** 悬浮展开要用布局服务的开关动作，与宿主自己的切换按钮一致。 */
      inject: ['layout'],
      apply(ctx) {
        ctx.effect(() => {
          /* 上一次加载留下的入口按钮与样式先清掉：热更新或重复挂载时不会叠加出两个 */
          for (const stale of document.querySelectorAll('[data-rail-workspace-button]')) stale.remove();
          for (const stale of document.querySelectorAll('style[data-plugin="@uitte/dsh-sidebar-restore"]')) stale.remove();

          const style = document.createElement('style');
          style.dataset.plugin = '@uitte/dsh-sidebar-restore';
          style.textContent = CSS;
          document.head.append(style);

          /* 工作区入口按钮：先建好，挂载位置由 mountEntry 按侧栏根容器决定 */
          const entry = document.createElement('button');
          entry.type = 'button';
          entry.dataset.railWorkspaceButton = '';
          entry.setAttribute('aria-label', '工作区');
          entry.setAttribute('title', '工作区');
          entry.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke-width="1.2" aria-hidden="true"><path d="${FOLDER_PATH}" stroke="currentColor"/></svg>`;

          /** 已绑定的三列外框。 */
          let frame = null;
          /** 上一次的轨道状态，用于识别收起／展开的切换。 */
          let rail = false;
          /** 最近一次展开态的侧栏宽度，滑动距离由它与轨道的差值决定。 */
          let expanded = DEFAULT_EXPANDED;
          /** 进行中的滑动动画。 */
          let slide = null;
          /** 解除 data-rail-instant 的帧句柄。 */
          let instantFrame = 0;
          /** 悬浮卡片是否展开。 */
          let flyout = false;
          /** 悬浮卡片是由插件展开侧栏撑开的，收起时要还原。 */
          let expandedByFlyout = false;
          /** 收起卡片的延迟句柄。 */
          let lingerTimer = 0;
          /** 定位按钮的帧句柄。 */
          let positionFrame = 0;
          /** 收起过渡是否还在进行。 */
          let settling = false;
          /** 点击收起后标记：指针没离开入口之前不再因悬停展开。 */
          let hoverClosed = false;
          /** 合并改写用的帧句柄。 */
          let rewriteFrame = 0;

          /* 只观察外框自身的几个属性；会话流式输出不会触发这里的改写 */
          const frameObserver = new MutationObserver(scheduleRewrite);

          /**
           * 把观察到的变更合并到下一帧再改写。
           * 直接同步改写会形成「改写样式 → 观察回调 → 再改写」的自激链，
           * 主线程被微任务占满，界面表现为卡死。
           */
          function scheduleRewrite() {
            if (rewriteFrame !== 0) return;
            rewriteFrame = requestAnimationFrame(() => {
              rewriteFrame = 0;
              rewrite();
            });
          }

          /** 三列外框：shell.overlay 层是它的直接子元素。 */
          function findFrame() {
            const overlay = document.querySelector('[data-shell-overlay]');
            if (overlay !== null && overlay.parentElement !== null) return overlay.parentElement;
            const column = document.querySelector('[class*="_sidebarCol"]');
            return column === null ? null : column.parentElement;
          }

          function bind(next) {
            frameObserver.disconnect();
            frameObserver.observe(next, {
              attributes: true,
              attributeFilter: ['style', 'data-sidebar-collapsed', 'data-sidebar-drawer'],
            });
            frame = next;
            rail = railActive(next);
          }

          /** 只有 Windows 桌面端、侧栏收起、且不在抽屉模式下才启用轨道。 */
          function railActive(candidate) {
            return (
              candidate.getAttribute('data-sidebar-collapsed') === 'true' &&
              !candidate.hasAttribute('data-sidebar-drawer') &&
              document.documentElement.hasAttribute('data-windows-titlebar')
            );
          }

          /** 首段轨道的像素宽度。 */
          function firstTrackOf(columns) {
            const match = /^(\d+(?:\.\d+)?)px/.exec(columns);
            return match === null ? null : Number(match[1]);
          }

          /** 把首段轨道换成给定值，其余两段原样保留。 */
          function replaceFirstTrack(columns, track) {
            const space = columns.indexOf(' ');
            return space < 0 ? track : track + columns.slice(space);
          }

          /**
           * 让中栏从旧位置滑到新位置。
           * 列宽此时已经是终值，这里只用 transform 复现位移，全程落在合成层。
           */
          function glide(offset) {
            const center = frame === null ? null : frame.querySelector('[class*="_centerCol"]');
            if (center === null) return;
            /* 连续点击时上一段被取消，它的 finished 会以 reject 结束；
               收尾只认当前这段，避免把新动画的标记一起清掉。 */
            slide?.cancel();
            frame.setAttribute('data-rail-slide', '');
            const animation = center.animate(
              [{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0px)' }],
              { duration: SLIDE_MS, easing: SLIDE_EASING },
            );
            slide = animation;
            const done = () => {
              if (slide !== animation) return;
              slide = null;
              if (frame !== null) frame.removeAttribute('data-rail-slide');
              settleInstant();
            };
            animation.finished.then(done, done);
          }

          /** 悬浮卡片开合前停止仍在运行的侧栏滑动。 */
          function cancelGlide() {
            if (slide === null) return;
            slide.cancel();
            slide = null;
            if (frame !== null) frame.removeAttribute('data-rail-slide');
            settleInstant();
          }

          /** 关掉外框过渡：两帧内确保列宽当场跳到终值。 */
          function holdInstant(target) {
            target.setAttribute('data-rail-instant', '');
            if (instantFrame !== 0) cancelAnimationFrame(instantFrame);
            instantFrame = requestAnimationFrame(() => {
              instantFrame = requestAnimationFrame(() => {
                instantFrame = 0;
                settleInstant();
              });
            });
          }

          /** 滑动结束前保持过渡关闭，结束后解除。 */
          function settleInstant() {
            if (instantFrame !== 0 || slide !== null) return;
            if (frame !== null) frame.removeAttribute('data-rail-instant');
          }

          /**
           * 把入口按钮挂到工作区区域之前，与工作区区域成为兄弟节点。
           * 位置由正常流的排布决定，和面板图标同一列同一节奏；侧栏子树重建了就重新挂。
           * 每次挂载前清掉页面里其它同类按钮，避免热更新留下的旧节点与新节点并存。
           *
           * 注意层级：_regionArea 在 _scrollRegion > _scrollArea 内部，是侧栏根容器
           * 的深度后代而不是直接子节点。拿它给根容器做 insertBefore 的参照节点会
           * 抛 NotFoundError（参照节点必须是该父节点的子节点），入口永远挂不上；
           * 参照节点只能交给它自己的父节点。
           */
          function mountEntry() {
            const root = document.querySelector('[data-slot="sidebar"] > [class*="_root"]');
            if (root === null) return;
            for (const other of document.querySelectorAll('[data-rail-workspace-button]')) {
              if (other !== entry) other.remove();
            }
            const region = root.querySelector('[class*="_regionArea"]');
            if (region === null || region.parentElement === null) return;
            /* 已经排在工作区区域正前方时不动它：无谓的摘下重插会在指针下
               重新派发指针事件，悬停判定要靠位置而不是事件，正为避开这一点。 */
            if (entry.nextElementSibling === region) return;
            region.parentElement.insertBefore(entry, region);
          }

          /** 卡片纵向从入口上缘起，偏移量按侧栏根容器顶边算。
           * 入口是工作区区域的兄弟节点、不在根容器直下，父节点不能再当挂载判据；
           * 两个矩形的差与入口挂在哪一层无关，照常算即可。
           * 顺带把入口在收起轨道里的纵向位置记进 --rail-entry-top：
           * 卡片展开时入口靠它钉回原位，只在它处于流式排布时才采信，
           * 钉住后的矩形是定位结果而不是轨道位置，不能拿来更新。 */
          function syncFlyoutTop() {
            const root = document.querySelector('[data-slot="sidebar"] > [class*="_root"]');
            if (root === null || !entry.isConnected) return;
            const base = root.getBoundingClientRect().top;
            const top = entry.getBoundingClientRect().top;
            document.documentElement.style.setProperty('--rail-flyout-top', `${Math.max(0, Math.round(top - base))}px`);
            if (!flyout && !settling && getComputedStyle(entry).position === 'static') {
              const rect = entry.getBoundingClientRect();
              if (rect.height > 0) {
                document.documentElement.style.setProperty('--rail-entry-top', `${Math.max(0, Math.round(rect.top - base))}px`);
              }
            }
            /* 账户按钮在轨道里的纵向位置同样记下来，供展开时钉位用；
               它在轨道里是相对定位（不是 static），只看尺寸是否有效 */
            if (!flyout && !settling) {
              const triggerRow = document.querySelector('[class*="_settingsArea"] [class*="_triggerRow"]');
              if (triggerRow !== null) {
                const rect = triggerRow.getBoundingClientRect();
                if (rect.height > 0) {
                  document.documentElement.style.setProperty('--rail-account-top', `${Math.max(0, Math.round(rect.top - base))}px`);
                }
              }
            }
          }

          function schedulePosition() {
            if (positionFrame !== 0) return;
            positionFrame = requestAnimationFrame(() => {
              positionFrame = 0;
              mountEntry();
              syncFlyoutTop();
            });
          }

          /** 展开工作区卡片：先锁住轨道外观，再让宿主渲染工作区会话。 */
          function openFlyout() {
            if (frame === null || !rail || flyout) return;
            cancelGlide();
            flyout = true;
            frame.setAttribute('data-rail-flyout', '');
            frame.removeAttribute('data-rail-settling');
            holdInstant(frame);
            expandedByFlyout = true;
            ctx.layout.toggleSidebar();
            rewrite();
          }

          /** 收起卡片并保持轨道样式，直到宿主确认回到收起态。 */
          function closeFlyout() {
            if (frame === null || !flyout) return;
            cancelGlide();
            flyout = false;
            frame.setAttribute('data-rail-settling', '');
            frame.removeAttribute('data-rail-flyout');
            holdInstant(frame);
            if (expandedByFlyout) {
              expandedByFlyout = false;
              if (!railActive(frame)) ctx.layout.toggleSidebar();
            }
            rewrite();
          }

          function cancelLinger() {
            if (lingerTimer === 0) return;
            window.clearTimeout(lingerTimer);
            lingerTimer = 0;
          }

          function armLinger() {
            cancelLinger();
            lingerTimer = window.setTimeout(() => {
              lingerTimer = 0;
              closeFlyout();
            }, FLYOUT_LINGER_MS);
          }

          /** 指针在入口按钮或卡片内就保持展开，离开后延时收起。 */
          function pointerInside(rect, event) {
            return (
              event.clientX >= rect.left &&
              event.clientX < rect.right &&
              event.clientY >= rect.top &&
              event.clientY < rect.bottom
            );
          }

          /**
           * 悬停展开由指针位置判定，不用入口按钮的 pointerenter。
           * 入口按钮挂在宿主的侧栏根容器里，宿主重渲染后会被重新插回原位置；
           * 重新插入会在指针下重新派发 pointerover，若以它作为展开条件，
           * 「展开 → 宿主重渲染 → 重新插入 → 再次展开」会自激成死循环。
           */
          function onPointerMove(event) {
            if (frame === null) return;
            const inEntry = pointerInside(entry.getBoundingClientRect(), event);
            if (!inEntry) hoverClosed = false;
            const region = flyout ? frame.querySelector('[class*="_regionArea"]') : null;
            const inCard = region === null ? false : pointerInside(region.getBoundingClientRect(), event);
            if (inEntry || inCard) {
              cancelLinger();
              if (!flyout && !hoverClosed) openFlyout();
              return;
            }
            if (flyout) armLinger();
          }

          /** 轨道保持 56px；普通侧栏切换时才用 transform 滑动中栏。 */
          function rewrite() {
            const current = frame !== null && frame.isConnected ? frame : findFrame();
            if (current === null) return;
            if (current !== frame) bind(current);

            const columns = current.style.gridTemplateColumns;
            const active = railActive(current);
            settling = current.hasAttribute('data-rail-settling');
            const locked = flyout || settling;

            document.documentElement.toggleAttribute('data-rail-workspace', active || locked);
            schedulePosition();

            if (locked) {
              rail = true;
              if (columns !== '' && !columns.startsWith(RAIL_TRACK)) {
                holdInstant(current);
                current.style.gridTemplateColumns = replaceFirstTrack(columns, RAIL_TRACK);
              }
              /* 只在值确实不同时写：改写样式属性本身会再触发一次观察回调，
                 无条件的重复写入会让回调链停不下来。 */
              if (current.style.getPropertyValue('--dsh-windows-sidebar-width') !== RAIL_TRACK) {
                current.style.setProperty('--dsh-windows-sidebar-width', RAIL_TRACK);
              }
              if (settling && active) current.removeAttribute('data-rail-settling');
              return;
            }

            const toggled = active !== rail;
            rail = active;
            if (columns === '') return;

            const width = firstTrackOf(columns);
            const travel = Math.max(RAIL, expanded) - RAIL;

            if (active) {
              if (toggled) {
                holdInstant(current);
                current.style.gridTemplateColumns = replaceFirstTrack(columns, RAIL_TRACK);
                glide(travel);
              } else if (columns.startsWith('0px')) {
                holdInstant(current);
                current.style.gridTemplateColumns = replaceFirstTrack(columns, RAIL_TRACK);
              }
              if (current.style.getPropertyValue('--dsh-windows-sidebar-width') !== RAIL_TRACK) {
                current.style.setProperty('--dsh-windows-sidebar-width', RAIL_TRACK);
              }
            } else {
              if (toggled) {
                holdInstant(current);
                glide(-travel);
              } else if (columns.startsWith(RAIL_TRACK)) {
                /* 展开、抽屉或退出桌面端：交回宿主，它的下一次渲染写回真实列宽 */
                holdInstant(current);
                current.style.gridTemplateColumns = replaceFirstTrack(columns, '0px');
              }
              if (width !== null && width > RAIL) expanded = width;
              if (current.style.getPropertyValue('--dsh-windows-sidebar-width') === RAIL_TRACK) {
                current.style.setProperty('--dsh-windows-sidebar-width', '0px');
              }
            }
          }

          entry.addEventListener('pointerleave', armLinger);
          entry.addEventListener('click', () => {
            if (flyout) {
              /* 点击收起后指针仍在入口上，等它离开再允许悬停展开 */
              hoverClosed = true;
              closeFlyout();
            } else {
              hoverClosed = false;
              openFlyout();
            }
          });
          document.addEventListener('pointermove', onPointerMove);

          const onResize = () => schedulePosition();
          window.addEventListener('resize', onResize);

          const initial = findFrame();
          if (initial !== null) bind(initial);
          rewrite();
          mountEntry();

          /* 顶栏标记由桌面 preload 写入，可能晚于本插件挂载 */
          const rootObserver = new MutationObserver(scheduleRewrite);
          rootObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-windows-titlebar', 'data-platform'],
          });

          /* 侧栏内容重排会带动入口位置与卡片起点，随之重新计算位置 */
          const columnObserver = new ResizeObserver(() => schedulePosition());
          const column = document.querySelector('[class*="_sidebarCol"]');
          if (column !== null) columnObserver.observe(column);

          /* 宿主的渲染可能重建侧栏子树，把入口重新挂回去 */
          const bodyObserver = new MutationObserver(() => {
            if (!entry.isConnected) mountEntry();
            if (frame === null || !frame.isConnected) scheduleRewrite();
          });
          bodyObserver.observe(document.body, { childList: true, subtree: true });

          return () => {
            rootObserver.disconnect();
            frameObserver.disconnect();
            columnObserver.disconnect();
            bodyObserver.disconnect();
            window.removeEventListener('resize', onResize);
            document.removeEventListener('pointermove', onPointerMove);
            if (lingerTimer !== 0) window.clearTimeout(lingerTimer);
            if (positionFrame !== 0) cancelAnimationFrame(positionFrame);
            slide?.cancel();
            slide = null;
            if (instantFrame !== 0) cancelAnimationFrame(instantFrame);
            instantFrame = 0;
            entry.remove();
            document.documentElement.removeAttribute('data-rail-workspace');
            document.documentElement.style.removeProperty('--rail-flyout-top');
            document.documentElement.style.removeProperty('--rail-entry-top');
            document.documentElement.style.removeProperty('--rail-account-top');
            if (frame !== null) {
              frame.removeAttribute('data-rail-slide');
              frame.removeAttribute('data-rail-instant');
              frame.removeAttribute('data-rail-flyout');
              frame.removeAttribute('data-rail-settling');
            }
            frame = null;
            style.remove();
          };
        }, 'sidebar-rail');
      },
    };
  },
});
