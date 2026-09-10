export type PrintOptions = {
  title: string;
  subtitle?: string;
};

export function printElement(element: HTMLElement, options: PrintOptions) {
  printHtml(element.innerHTML, options);
}

export function printHtml(content: string, options: PrintOptions) {
  const styles = Array.from(document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
    'link[rel="stylesheet"], style',
  ))
    .map((node) => node.outerHTML)
    .join("\n");

  const frame = document.createElement("iframe");
  frame.setAttribute("title", "Print report");
  frame.style.position = "fixed";
  frame.style.left = "0";
  frame.style.top = "0";
  frame.style.width = "100vw";
  frame.style.height = "auto";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  frame.style.border = "0";
  document.body.appendChild(frame);

  const frameDocument = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDocument || !frameWindow) {
    frame.remove();
    return;
  }

  frameDocument.open();
  frameDocument.write(`<!doctype html><html><head><title>${escapeHtml(options.title)}</title>${styles}<style>@page{size:landscape;margin:10mm}html,body{background:white}body{padding:24px;font-family:Arial,sans-serif;color:#0f172a;overflow:visible}.print-report-title{display:block;margin-bottom:16px;border-bottom:2px solid #0f172a;padding-bottom:8px}.print-report-title h1{font-size:18px;margin:0 0 4px}.print-report-title p{font-size:11px;margin:0;color:#475569}.print-report-content{width:100%;height:auto;overflow:visible}.print-report-content table{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 18px;page-break-inside:avoid;break-inside:avoid}.print-report-content thead{display:table-header-group}.print-report-content th,.print-report-content td{border:1px solid #94a3b8!important;border-radius:0!important;padding:5px;font-size:9px;vertical-align:top;word-break:break-word;box-shadow:none!important}.print-report-content th{background:#f1f5f9!important;font-weight:700}.print-report-content .batch-title{font-size:12px;font-weight:700;margin:10px 0 5px;border-bottom:1px solid #cbd5e1;padding-bottom:3px;break-after:avoid}.print-report-content .batch-table + .batch-table{break-before:page;page-break-before:always}.print-report-content .empty-cell{color:#94a3b8;text-align:center}.print-report-content .special-cell{background:#f5f3ff!important}.print-report-content .break-cell{background:#f8fafc!important;text-align:center}.print-report-content .subject-cell{background:#eff6ff!important}.print-report-content .rounded-lg,.print-report-content .rounded-md,.print-report-content .rounded,.print-report-content .shadow-sm{border-radius:0!important;box-shadow:none!important}.print-report-content table td>div{min-height:0!important;height:auto!important;border-radius:0!important;border:0!important;box-shadow:none!important;background:transparent!important;padding:0!important}.print-report-content table td>div>div{border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important;padding:0!important;margin:0!important}.print-report-content button,.print-report-content [role="button"]{display:none!important}.print-hidden{display:none!important}@media print{body{padding:0;overflow:visible}.print-hidden{display:none!important}}</style></head><body><header class="print-report-title"><h1>${escapeHtml(options.title)}</h1>${options.subtitle ? `<p>${escapeHtml(options.subtitle)}</p>` : ""}</header><main class="print-report-content">${content}</main></body></html>`);
  frameDocument.head.insertAdjacentHTML(
    "beforeend",
    "<style>@page{size:landscape;margin:10mm 16mm 10mm 10mm}html,body{width:auto;min-width:0;max-width:none;height:auto;min-height:0;max-height:none;margin:0;padding:0;overflow:visible;box-sizing:border-box}.print-report-content{width:100%!important;max-width:100%!important;min-width:0!important;height:auto!important;max-height:none!important;overflow:visible!important;box-sizing:border-box}.print-report-content table{width:100%!important;min-width:0!important;max-width:100%!important;table-layout:fixed;break-inside:avoid;page-break-inside:avoid;box-sizing:border-box}.print-report-content table,.print-report-content tr,.print-report-content td,.print-report-content th{box-sizing:border-box}.print-report-content td,.print-report-content th{overflow-wrap:anywhere;word-break:break-word}.print-report-content [class*='overflow-x-auto'],.print-report-content [class*='overflow-auto']{width:100%!important;max-width:100%!important;overflow:visible!important}.print-report-content .batch-section{break-inside:avoid;page-break-inside:avoid;margin:0 0 12px}.print-report-content .batch-section + .batch-section{break-before:page;page-break-before:always}.print-report-content .batch-table{break-inside:avoid;page-break-inside:avoid}</style>",
  );
  frameDocument.close();

  let printed = false;
  const print = async () => {
    if (printed) return;
    printed = true;
    if (frameDocument.fonts?.ready) await frameDocument.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    frameWindow.focus();
    frameWindow.print();
    window.setTimeout(() => frame.remove(), 500);
  };

  frame.onload = () => void print();
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}
