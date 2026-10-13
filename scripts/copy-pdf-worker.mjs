import { createRequire } from "node:module";
import { copyFileSync } from "node:fs";
const require = createRequire(import.meta.url);
copyFileSync(require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"), new URL("../public/pdf.worker.min.mjs", import.meta.url));
