#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Config
const owner  = "drak0niii";
const repo   = "Launch-CTRL";
const branch = "main";
const base   = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`;

const outputFile = "raw_urls.txt";

// Resolve directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Repository root = current working directory
const repoRoot = process.cwd();

// Recursively walk directory tree
function walk(dir, fileList = []) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  files.forEach(entry => {
    const fullPath = path.join(dir, entry.name);

    // Skip ignored folders
    if (entry.isDirectory()) {
      if (!fullPath.includes("node_modules") && !fullPath.includes(".git")) {
        walk(fullPath, fileList);
      }
    } else {
      fileList.push(fullPath);
    }
  });

  return fileList;
}

// Run the collector
const allFiles = walk(repoRoot);

// Convert file paths to raw GitHub URLs
const urls = allFiles.map(f => {
  const relative = path.relative(repoRoot, f).replace(/\\/g, "/");
  return base + relative;
});

// Write output
fs.writeFileSync(outputFile, urls.join("\n"));

// Final status message
console.log("");
console.log("--------------------------------------");
console.log(" Raw GitHub URL export completed");
console.log(` Repository : ${owner}/${repo} (branch: ${branch})`);
console.log(` Files exported: ${urls.length}`);
console.log(` Output file: ${outputFile}`);
console.log(` Location: ${repoRoot}`);
console.log("--------------------------------------");
console.log("");

