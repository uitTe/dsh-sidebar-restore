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
  factory(require) {
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
        /* 背景优先用「侧边栏设置」里的自定义色（--sidebar-restore-bg，
           1.1.0），没设时回落宿主的侧栏填充色，行为与之前一致 */
        background: var(--sidebar-restore-bg, var(--dsw-specific-sidebar-fill)) !important;
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

      /* 自定义侧边栏背景色（设置页「侧边栏设置」页签，1.1.0）：颜色存
         localStorage，启用时 html 上有 data-sidebar-restore-bg 属性、
         --sidebar-restore-bg 变量。这里换侧栏根列的背景（停靠与轨道
         共用）；悬浮卡片的背景由它自己的规则以
         var(--sidebar-restore-bg, 宿主填充色) 优先取自定义色。
         未设置时这条不生效，背景跟随主题。 */
      /* 注意：真正画出侧栏背景的是内层根容器（hHd-Xa_root），外层布局列
         只是包着它——只改外层会被内层盖住、看不见变化，两层一起改。 */
      html[data-sidebar-restore-bg] [class*="_sidebarCol"],
      html[data-sidebar-restore-bg] [class*="_sidebarCol"] [class*="_root"] {
        background-color: var(--sidebar-restore-bg) !important;
      }

      /* 自定义文字与图标颜色（1.1.0 补）：宿主侧栏的文字与图标颜色由
         --dsw-alias-label-* 系列变量驱动（图标多为 currentColor），在
         根列上改 color 并重定向这组变量即可整列换色；次级文字用
         color-mix 压透以保持原有的主次层次。悬浮卡片在根列之内，
         同样生效。未设置时这条不生效。 */
      html[data-sidebar-restore-fg] [class*="_sidebarCol"] {
        color: var(--sidebar-restore-fg) !important;
        --dsw-alias-label-primary: var(--sidebar-restore-fg) !important;
        --dsw-alias-label-secondary: color-mix(in srgb, var(--sidebar-restore-fg) 70%, transparent) !important;
        --dsw-alias-label-tertiary: color-mix(in srgb, var(--sidebar-restore-fg) 55%, transparent) !important;
        --dsw-alias-label-caption: color-mix(in srgb, var(--sidebar-restore-fg) 55%, transparent) !important;
        --dsw-alias-label-dimmed: color-mix(in srgb, var(--sidebar-restore-fg) 45%, transparent) !important;
        /* 新建会话按钮自带主题的凸起填充（浅色主题下是纯白），文字色
           被换成自定义色后会白底白字看不见；把它的填充一并改成自
           定义色的淡色调，悬停填充同理，按钮始终是可读的浅/深色片。 */
        --dsw-alias-button-elevated-fill: color-mix(in srgb, var(--sidebar-restore-fg) 14%, transparent) !important;
        --dsw-alias-button-floating-hover: color-mix(in srgb, var(--sidebar-restore-fg) 22%, transparent) !important;
      }

      /* 简洁轨道（设置页开关，1.1.0 补）：收起态只保留鲸鱼标志、新建
         会话、工作区入口与个人头像——中间的面板列表整段隐藏（插件、
         自动化任务、更多以及其他插件加的面板都在这个列表里）。鲸鱼
         标志在品牌行、新建会话与头像各有自己的行、工作区入口是插件
         自己的按钮，都不在面板列表内，不受影响。停靠态不走这条。 */
      html[data-windows-titlebar][data-sidebar-restore-minimal] ${RAIL_STATE} > [class*="_sidebarCol"] [class*="_panelList"] {
        display: none !important;
      }

      /* 按面板单独隐藏（设置页勾选，1.1.0 补）：被打上标记的面板项在
         收起态不显示；标记由脚本按存储的隐藏名单打在面板项外层。 */
      html[data-windows-titlebar] ${RAIL_STATE} > [class*="_sidebarCol"] [data-sidebar-restore-hidden] {
        display: none !important;
      }
    `;

    /* ——— 自定义侧边栏颜色（1.1.0）———
       设置页里加一个「侧边栏设置」页签（官方 settings.section 槽位），
       可分别设置背景色与文字/图标颜色。颜色存 localStorage；启用时
       给 html 写对应变量并打标记，样式表末尾的规则据此换色。
       React 与槽位都是附加能力：取不到或注册失败，只丢这个页签，
       不影响轨道本体。 */
    /* 一项颜色设置的三件套：读存储、刷到 html、写存储并刷。 */
    const createSidebarColor = (storageKey, cssVar, attr) => ({
      read() {
        try { return window.localStorage.getItem(storageKey) || ''; } catch { return ''; }
      },
      paint(value) {
        const root = document.documentElement;
        if (/^#[0-9a-f]{6}$/i.test(value || '')) {
          root.style.setProperty(cssVar, value);
          root.setAttribute(attr, '');
        } else {
          root.style.removeProperty(cssVar);
          root.removeAttribute(attr);
        }
      },
      set(value) {
        try {
          if (value) window.localStorage.setItem(storageKey, value);
          else window.localStorage.removeItem(storageKey);
        } catch { /* 本地存储不可用时，仅本次会话内生效 */ }
        this.paint(value);
      },
    });
    const bgColor = createSidebarColor('dsh-sidebar-restore:sidebar-bg', '--sidebar-restore-bg', 'data-sidebar-restore-bg');
    const fgColor = createSidebarColor('dsh-sidebar-restore:sidebar-fg', '--sidebar-restore-fg', 'data-sidebar-restore-fg');
    const readSidebarBg = bgColor.read;
    const paintSidebarBg = bgColor.paint;
    const readSidebarFg = fgColor.read;
    const paintSidebarFg = fgColor.paint;

    /* 简洁轨道开关：与颜色一样存 localStorage，启用时 html 打标记。 */
    const MINIMAL_STORAGE_KEY = 'dsh-sidebar-restore:minimal-rail';
    const readMinimalRail = () => {
      try { return window.localStorage.getItem(MINIMAL_STORAGE_KEY) === '1'; } catch { return false; }
    };
    const paintMinimalRail = (on) => {
      document.documentElement.toggleAttribute('data-sidebar-restore-minimal', !!on);
    };
    const setMinimalRail = (on) => {
      try {
        if (on) window.localStorage.setItem(MINIMAL_STORAGE_KEY, '1');
        else window.localStorage.removeItem(MINIMAL_STORAGE_KEY);
      } catch { /* 本地存储不可用时，仅本次会话内生效 */ }
      paintMinimalRail(on);
    };

    /* ——— 按面板单独隐藏（1.1.0 补）———
       面板列表每一项的外层元素里都有一个行按钮，其 aria-label 就是
       面板名（插件、自动化任务、更多，以及其他插件加的面板如插件
       市场、上下文洞察），以它为键存隐藏名单——名单内容因此天然是
       「当前用户实际装了哪些面板」。宿主重建侧栏后，由已有的
       bodyObserver 回调重新打标记。 */
    const HIDDEN_PANELS_KEY = 'dsh-sidebar-restore:hidden-panels';
    const readHiddenPanels = () => {
      try {
        const raw = window.localStorage.getItem(HIDDEN_PANELS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
      } catch { return []; }
    };
    const panelKeyOf = (item) => {
      const btn = item.querySelector('button');
      const key = (btn?.getAttribute('aria-label') || item.textContent || '').trim().replace(/\s+/g, ' ');
      return key || null;
    };
    const listSidebarPanels = () => {
      const list = document.querySelector('[class*="_sidebarCol"] [class*="_panelList"]');
      if (!list) return [];
      const out = [];
      for (const item of list.children) {
        const key = panelKeyOf(item);
        if (key && !out.some(p => p.key === key)) out.push({ key, el: item });
      }
      return out;
    };
    const applyHiddenPanels = () => {
      const hidden = new Set(readHiddenPanels());
      for (const { key, el } of listSidebarPanels()) {
        if (hidden.has(key)) el.setAttribute('data-sidebar-restore-hidden', '');
        else el.removeAttribute('data-sidebar-restore-hidden');
      }
    };
    const setPanelHidden = (key, hide) => {
      const arr = readHiddenPanels().filter(k => k !== key);
      if (hide) arr.push(key);
      try { window.localStorage.setItem(HIDDEN_PANELS_KEY, JSON.stringify(arr)); } catch { /* 忽略 */ }
      applyHiddenPanels();
      return arr;
    };
    const isZhLang = () => ((document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('zh'));

    let ReactLib = null;
    try { ReactLib = typeof require === 'function' ? require('react') : null; } catch { ReactLib = null; }

    const BG_PRESETS = ['', '#f9fafb', '#ffffff', '#e8f0fe', '#fef3c7', '#1b1b1c', '#111827', '#1e3a8a', '#14532d', '#7f1d1d'];
    const FG_PRESETS = ['', '#f9fafb', '#ffffff', '#d1d5db', '#9ca3af', '#374151', '#1b1b1c', '#000000', '#7dd3fc', '#fca5a5'];

    function SidebarSettingsSection() {
      const h = ReactLib.createElement;
      const zh = isZhLang();
      const [bg, setBg] = ReactLib.useState(() => bgColor.read());
      const [bgHex, setBgHex] = ReactLib.useState(() => bgColor.read());
      const [fg, setFg] = ReactLib.useState(() => fgColor.read());
      const [fgHex, setFgHex] = ReactLib.useState(() => fgColor.read());
      const [minimal, setMinimal] = ReactLib.useState(() => readMinimalRail());
      /* 打开页签这一刻，侧栏里实际存在的面板（动态读取） */
      const [panels] = ReactLib.useState(() => listSidebarPanels().map(p => p.key));
      const [hiddenPanels, setHiddenPanels] = ReactLib.useState(() => readHiddenPanels());
      const fieldStyle = { padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(140,140,140,.4)', background: 'transparent', color: 'inherit', fontSize: 13 };
      /* 一组颜色设置：标题、色块、取色器与十六进制输入、恢复默认、状态行 */
      const group = ({ title, presets, custom, hex, setHex, apply }) => {
        const choose = (value) => apply(value);
        const commitHex = () => {
          const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
          if (m) choose(`#${m[1].toLowerCase()}`);
          else setHex(custom);
        };
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, title),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
            presets.map((value) => h('button', {
              key: value || 'theme',
              type: 'button',
              title: value || (zh ? '跟随主题' : 'Follow theme'),
              onClick: () => choose(value),
              style: {
                width: 30, height: 30, borderRadius: 8, cursor: 'pointer', padding: 0,
                border: custom === value ? '2px solid #4f7cff' : '1px solid rgba(140,140,140,.45)',
                background: value || 'linear-gradient(135deg, rgba(0,0,0,0) 46%, rgba(150,150,150,.85) 46%, rgba(150,150,150,.85) 54%, rgba(0,0,0,0) 54%)',
              },
            }))),
          h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
            h('input', {
              type: 'color',
              value: /^#[0-9a-f]{6}$/i.test(custom) ? custom : '#1b1b1c',
              onChange: (e) => choose(e.target.value),
              style: { width: 46, height: 34, padding: 0, border: 'none', background: 'none', cursor: 'pointer' },
            }),
            h('input', {
              type: 'text', value: hex, placeholder: '#RRGGBB', spellCheck: false,
              onChange: (e) => setHex(e.target.value),
              onBlur: commitHex,
              onKeyDown: (e) => { if (e.key === 'Enter') commitHex(); },
              style: { ...fieldStyle, width: 112, fontFamily: 'ui-monospace, monospace' },
            }),
            h('button', { type: 'button', onClick: () => choose(''), style: { ...fieldStyle, cursor: 'pointer' } },
              zh ? '恢复默认' : 'Reset')),
          h('div', { style: { fontSize: 12, opacity: 0.65 } },
            custom
              ? (zh ? `当前自定义颜色：${custom}` : `Current custom color: ${custom}`)
              : (zh ? '当前跟随主题（未自定义）' : 'Currently following the theme (no custom color)')));
      };
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 520, padding: '4px 0' } },
        h('div', { style: { fontSize: 15, fontWeight: 600 } }, zh ? '侧边栏设置' : 'Sidebar settings'),
        h('div', { style: { fontSize: 12.5, opacity: 0.65, lineHeight: 1.6 } },
          zh
            ? '自定义侧边栏的背景颜色与文字/图标颜色，应用于停靠侧边栏、收起后的图标轨道和工作区悬浮卡片。换深色背景时记得把文字/图标调成浅色，反之亦然；每组选第一个色块（跟随主题）即可恢复默认。'
            : 'Customize the sidebar background and text/icon colors. They apply to the docked sidebar, the collapsed icon rail and the workspace flyout card. With a dark background, pick a light text color (and vice versa). The first swatch in each group (Follow theme) restores the default.'),
        group({
          title: zh ? '背景颜色' : 'Background color',
          presets: BG_PRESETS,
          custom: bg, hex: bgHex, setHex: setBgHex,
          apply: (v) => { bgColor.set(v); setBg(v); setBgHex(v); },
        }),
        group({
          title: zh ? '文字与图标颜色' : 'Text & icon color',
          presets: FG_PRESETS,
          custom: fg, hex: fgHex, setHex: setFgHex,
          apply: (v) => { fgColor.set(v); setFg(v); setFgHex(v); },
        }),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 } },
            h('input', {
              type: 'checkbox', checked: minimal,
              onChange: (e) => { setMinimalRail(e.target.checked); setMinimal(e.target.checked); },
              style: { width: 16, height: 16, cursor: 'pointer', margin: 0 },
            }),
            zh ? '简洁轨道：隐藏其他图标' : 'Minimal rail: hide other icons'),
          h('div', { style: { fontSize: 12, opacity: 0.65, lineHeight: 1.6 } },
            zh
              ? '收起侧边栏时只保留鲸鱼标志、新建会话、工作区和个人头像，其余面板图标（插件、自动化任务、更多，以及其他插件加的面板）全部隐藏。停靠展开时不受影响。'
              : 'When the sidebar is collapsed, keep only the whale logo, New session, Workspaces and your avatar. All other panel icons (Plugins, Automation tasks, More, and panels added by other plugins) are hidden. The docked sidebar is unaffected.')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, zh ? '单独隐藏图标（收起时）' : 'Hide individual icons (collapsed)'),
          h('div', { style: { fontSize: 12, opacity: 0.65, lineHeight: 1.6 } },
            zh
              ? '以下是当前侧边栏里实际存在的面板（按你安装的插件动态读取）。勾选的面板在收起轨道时隐藏，停靠展开时仍显示；上方「简洁轨道」打开时整段隐藏，与此处无关。'
              : 'These are the panels actually present in your sidebar right now, read live from the UI based on your installed plugins. Checked panels are hidden in the collapsed rail and still shown when docked. The minimal-rail switch above hides the whole list regardless.'),
          panels.length === 0
            ? h('div', { style: { fontSize: 12, opacity: 0.65 } }, zh ? '（未读取到面板列表）' : '(No panels found)')
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                panels.map((key) => h('label', { key, style: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 } },
                  h('input', {
                    type: 'checkbox',
                    checked: hiddenPanels.includes(key),
                    onChange: (e) => setHiddenPanels(setPanelHidden(key, e.target.checked)),
                    style: { width: 15, height: 15, cursor: 'pointer', margin: 0 },
                  }),
                  key)))));
    }

    return {
      /** 悬浮展开要用布局服务的开关动作，与宿主自己的切换按钮一致；
          slots 是设置页签注册要用的槽位服务。 */
      inject: ['layout', 'slots'],
      apply(ctx) {
        ctx.effect(() => {
          /* 上一次加载留下的入口按钮与样式先清掉：热更新或重复挂载时不会叠加出两个 */
          for (const stale of document.querySelectorAll('[data-rail-workspace-button]')) stale.remove();
          for (const stale of document.querySelectorAll('style[data-plugin="@uitte/dsh-sidebar-restore"]')) stale.remove();

          const style = document.createElement('style');
          style.dataset.plugin = '@uitte/dsh-sidebar-restore';
          style.textContent = CSS;
          document.head.append(style);

          /* 自定义侧边栏颜色：把上次存下的背景色与文字/图标色先刷上 */
          paintSidebarBg(readSidebarBg());
          paintSidebarFg(readSidebarFg());
          paintMinimalRail(readMinimalRail());

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
          applyHiddenPanels();

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
            applyHiddenPanels();
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
            paintSidebarBg('');
            paintSidebarFg('');
            paintMinimalRail(false);
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

        /* 设置页里加「侧边栏设置」页签：走官方 settings.section 槽位。
           这是附加功能，React 或槽位不可用时静默放弃，不影响轨道本体。 */
        if (ReactLib) {
          try {
            ctx.slots.inject('settings.section', () => ctx.slots.register({
              name: 'settings.section',
              id: 'sidebar-restore',
              order: 20,
              label: () => (isZhLang() ? '侧边栏设置' : 'Sidebar settings'),
            }, SidebarSettingsSection));
          } catch { /* 槽位注册失败时静默 */ }
        }
      },
    };
  },
});
