/**
 * 文件类型 → 内置字体图标映射。
 *
 * 为什么不用 @fluentui/react-file-type-icons：
 * 它注册的是 `<img src="https://res.cdn.office.net/...">`，依赖外部 CDN，
 * 在国内网络下经常加载不出来（表现为图标空白）。
 * 这里改用 Fluent UI 自带的 MDL2 字体图标，纯离线、必定可见。
 */
const EXT_ICON: Record<string, string> = {
    // 文本 / 文档
    txt: "TextDocument",
    log: "TextDocument",
    md: "TextDocument",
    json: "FileCode",
    xml: "FileCode",
    yaml: "FileCode",
    yml: "FileCode",
    ini: "FileCode",
    conf: "FileCode",
    cfg: "FileCode",
    csv: "ExcelDocument",
    xls: "ExcelDocument",
    xlsx: "ExcelDocument",
    doc: "WordDocument",
    docx: "WordDocument",
    ppt: "PowerPointDocument",
    pptx: "PowerPointDocument",
    pdf: "PDF",
    one: "OneNoteLogo",
    // 图片
    png: "FileImage",
    jpg: "FileImage",
    jpeg: "FileImage",
    gif: "FileImage",
    bmp: "FileImage",
    webp: "FileImage",
    svg: "FileImage",
    ico: "FileImage",
    heic: "FileImage",
    // 音频 / 视频
    mp3: "MusicNote",
    wav: "MusicNote",
    flac: "MusicNote",
    aac: "MusicNote",
    ogg: "MusicNote",
    m4a: "MusicNote",
    mp4: "Video",
    avi: "Video",
    mkv: "Video",
    mov: "Video",
    webm: "Video",
    flv: "Video",
    // 压缩包
    zip: "ZipFolder",
    rar: "ZipFolder",
    "7z": "ZipFolder",
    tar: "ZipFolder",
    gz: "ZipFolder",
    bz2: "ZipFolder",
    xz: "ZipFolder",
    // 代码 / 脚本
    js: "FileCode",
    mjs: "FileCode",
    cjs: "FileCode",
    ts: "FileCode",
    tsx: "FileCode",
    jsx: "FileCode",
    java: "FileCode",
    kt: "FileCode",
    c: "FileCode",
    h: "FileCode",
    cpp: "FileCode",
    hpp: "FileCode",
    py: "FileCode",
    go: "FileCode",
    rs: "FileCode",
    rb: "FileCode",
    php: "FileCode",
    swift: "FileCode",
    sh: "Script",
    bat: "Script",
    cmd: "Script",
    ps1: "Script",
    vbs: "Script",
    css: "FileCode",
    scss: "FileCode",
    less: "FileCode",
    html: "FileCode",
    htm: "FileCode",
    // 安装包 / 二进制
    apk: "Package",
    aab: "Package",
    ipa: "Package",
    exe: "Product",
    msi: "Product",
    deb: "Package",
    rpm: "Package",
    so: "Code",
    dll: "Code",
    jar: "Package",
    bin: "Code",
    img: "HardDrive",
    iso: "HardDrive",
    // 数据库 / 其他
    db: "HardDrive",
    sqlite: "HardDrive",
    sql: "FileCode",
    ttf: "TextDocument",
    otf: "TextDocument",
    woff: "TextDocument",
    woff2: "TextDocument",
};

/** 扩展名（小写，不含点）→ Fluent UI 图标名 */
export function iconNameForExtension(ext: string): string {
    return EXT_ICON[ext.toLowerCase()] ?? "Page";
}

/** 取文件名扩展名（小写，不含点） */
export function extensionOf(filename: string): string {
    const i = filename.lastIndexOf(".");
    if (i < 0 || i === filename.length - 1) return "";
    return filename.slice(i + 1).toLowerCase();
}
