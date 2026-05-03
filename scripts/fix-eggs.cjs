const fs = require("fs");
const path = require("path");
const dir = "C:/Users/Dan/Repo/petforge/src/render/species";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "index.ts");
let fixed = 0;
for (const f of files) {
  const fp = path.join(dir, f);
  let code = fs.readFileSync(fp, "utf8");
  const orig = code;
  // Fix unescaped backtick before --' in egg array entries:
  //   `\n `--'`  ->  `\n \`--'`
  code = code.replace(/\\n `--/g, "\\n \\`--");
  if (code !== orig) {
    fs.writeFileSync(fp, code);
    console.log("fixed:", f);
    fixed++;
  }
}
console.log("Total fixed:", fixed);
