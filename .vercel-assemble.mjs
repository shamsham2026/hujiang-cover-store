import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
function join(parts, out) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.concat(parts.map((part) => readFileSync(part))))
}
join(["upload-parts/s-00", "upload-parts/s-01a", "upload-parts/s-01b", "upload-parts/s-02", "upload-parts/s-03", "upload-parts/s-04", "upload-parts/s-05", "upload-parts/s-06", "upload-parts/s-07", "upload-parts/s-08", "upload-parts/s-09", "upload-parts/s-10", "upload-parts/s-11"], "data/seed.json")
join(["upload-parts/l-00", "upload-parts/l-01", "upload-parts/l-02", "upload-parts/l-03", "upload-parts/l-04a1", "upload-parts/l-04a2", "upload-parts/l-04b", "upload-parts/l-05", "upload-parts/l-06", "upload-parts/l-07", "upload-parts/l-08", "upload-parts/l-09", "upload-parts/l-10", "upload-parts/l-11a", "upload-parts/l-11b", "upload-parts/l-12", "upload-parts/l-13", "upload-parts/l-14", "upload-parts/l-15a", "upload-parts/l-15b", "upload-parts/l-16", "upload-parts/l-17a", "upload-parts/l-17b", "upload-parts/l-18"], "package-lock.json")
