import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";

const MIHOMO_VERSION = "v1.19.27";
const RELEASE_BASE_URL = `https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VERSION}`;
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BINARIES_DIR = join(PROJECT_ROOT, "src-tauri", "binaries");
const CACHE_DIR = join(PROJECT_ROOT, ".cache", "mihomo");

const targets = {
  "x86_64-pc-windows-msvc": {
    asset: `mihomo-windows-amd64-${MIHOMO_VERSION}.zip`,
    sha256: "34b4c5bc0c176eebd298f6624aa23ea41985a2c54efb04eb0e9c4542e45190ee",
    extension: ".exe",
  },
  "aarch64-pc-windows-msvc": {
    asset: `mihomo-windows-arm64-${MIHOMO_VERSION}.zip`,
    sha256: "dcbfe6f81a72dfb6b8b549f1aec32eb47644e592ac7dffefc026b15e9c25213a",
    extension: ".exe",
  },
  "x86_64-apple-darwin": {
    asset: `mihomo-darwin-amd64-${MIHOMO_VERSION}.gz`,
    sha256: "5392bea435a1c4b0a496571daafa977f744207cfafac18fb78a9b7d0747585c2",
    extension: "",
  },
  "aarch64-apple-darwin": {
    asset: `mihomo-darwin-arm64-${MIHOMO_VERSION}.gz`,
    sha256: "3617c9d8a5a55aecfe1ebd0f55ff59f2706c8ad68fd65c6c4e5f7cf2b74263f1",
    extension: "",
  },
  "x86_64-unknown-linux-gnu": {
    asset: `mihomo-linux-amd64-${MIHOMO_VERSION}.gz`,
    sha256: "fb3e34c55844f389ff54679e5a3aec331d5ec38006c20f8dcc476fb47768a58f",
    extension: "",
  },
  "aarch64-unknown-linux-gnu": {
    asset: `mihomo-linux-arm64-${MIHOMO_VERSION}.gz`,
    sha256: "87db0c6660a9557a901b5750f997967e71d8c0af07ea1d1dd4d04c28da7f7e6f",
    extension: "",
  },
};

function targetTriple() {
  const targetArgument = process.argv.find((argument) => argument.startsWith("--target="));
  if (targetArgument) return targetArgument.slice("--target=".length);

  const targetIndex = process.argv.indexOf("--target");
  if (targetIndex >= 0 && process.argv[targetIndex + 1]) return process.argv[targetIndex + 1];

  return process.env.TAURI_ENV_TARGET_TRIPLE
    || process.env.CARGO_BUILD_TARGET
    || execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function loadArchive(target) {
  const cachePath = join(CACHE_DIR, target.asset);
  try {
    const cached = await readFile(cachePath);
    if (sha256(cached) === target.sha256) return cached;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const url = `${RELEASE_BASE_URL}/${target.asset}`;
  console.log(`正在下载 Mihomo ${MIHOMO_VERSION}：${target.asset}`);
  const response = await fetch(url, { headers: { "User-Agent": "clash-mg-build" } });
  if (!response.ok) throw new Error(`下载 Mihomo 失败：HTTP ${response.status} ${response.statusText}`);

  const archive = Buffer.from(await response.arrayBuffer());
  const actualSha256 = sha256(archive);
  if (actualSha256 !== target.sha256) {
    throw new Error(`Mihomo 校验失败：期望 ${target.sha256}，实际 ${actualSha256}`);
  }

  await mkdir(CACHE_DIR, { recursive: true });
  const temporaryPath = `${cachePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, archive);
  await rm(cachePath, { force: true });
  await rename(temporaryPath, cachePath);
  return archive;
}

function extractZipExecutable(archive) {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  let eocdOffset = -1;

  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (archive.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Mihomo ZIP 包缺少中央目录");

  const entries = archive.readUInt16LE(eocdOffset + 10);
  let offset = archive.readUInt32LE(eocdOffset + 16);
  for (let index = 0; index < entries; index += 1) {
    if (archive.readUInt32LE(offset) !== centralSignature) throw new Error("Mihomo ZIP 中央目录损坏");

    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (name.toLowerCase().endsWith(".exe")) {
      if (archive.readUInt32LE(localOffset) !== localSignature) throw new Error("Mihomo ZIP 本地文件头损坏");
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
      const executable = compressionMethod === 0
        ? Buffer.from(compressed)
        : compressionMethod === 8
          ? inflateRawSync(compressed)
          : null;
      if (!executable) throw new Error(`Mihomo ZIP 使用了不支持的压缩方式：${compressionMethod}`);
      if (executable.length !== uncompressedSize) throw new Error("Mihomo ZIP 解压后的文件大小不匹配");
      return executable;
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error("Mihomo ZIP 包中没有可执行文件");
}

async function main() {
  const triple = targetTriple();
  const target = targets[triple];
  if (!target) {
    throw new Error(`暂不支持目标平台 ${triple}；当前支持：${Object.keys(targets).join("、")}`);
  }

  const archive = await loadArchive(target);
  const executable = target.asset.endsWith(".zip") ? extractZipExecutable(archive) : gunzipSync(archive);
  const outputPath = join(BINARIES_DIR, `mihomo-${triple}${target.extension}`);
  await mkdir(BINARIES_DIR, { recursive: true });
  await writeFile(outputPath, executable);
  if (!target.extension) await chmod(outputPath, 0o755);
  console.log(`Mihomo ${MIHOMO_VERSION} 已准备：${outputPath}`);
}

await main();
