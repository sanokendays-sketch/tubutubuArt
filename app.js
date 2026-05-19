(function () {
  "use strict";

  const THUMBNAIL_SIZE = 80;
  const MAX_TILE_IMAGES = 1000;
  const YIELD_EVERY_TILES = 180;

  const sourceInput = document.getElementById("sourceImage");
  const tileInput = document.getElementById("tileImages");
  const sourceStatus = document.getElementById("sourceStatus");
  const tileStatus = document.getElementById("tileStatus");
  const tileGuidance = document.getElementById("tileGuidance");
  const overlayInput = document.getElementById("overlayStrength");
  const overlayValue = document.getElementById("overlayValue");
  const generateButton = document.getElementById("generateButton");
  const resetButton = document.getElementById("resetButton");
  const downloadButton = document.getElementById("downloadButton");
  const downloadHtmlButton = document.getElementById("downloadHtmlButton");
  const messageArea = document.getElementById("messageArea");
  const usageStats = document.getElementById("usageStats");
  const canvas = document.getElementById("previewCanvas");
  const emptyPreview = document.getElementById("emptyPreview");
  const previewSize = document.getElementById("previewSize");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let sourceImage = null;
  let sourceFileName = "";
  let tileLibrary = [];
  let isWorking = false;
  let lastMosaicInfo = null;

  sourceInput.addEventListener("change", handleSourceChange);
  tileInput.addEventListener("change", handleTileChange);
  overlayInput.addEventListener("input", updateOverlayLabel);
  generateButton.addEventListener("click", generateMosaic);
  resetButton.addEventListener("click", resetApp);
  downloadButton.addEventListener("click", downloadMosaic);
  downloadHtmlButton.addEventListener("click", downloadMosaicHtml);

  updateOverlayLabel();

  async function handleSourceChange(event) {
    const file = event.target.files && event.target.files[0];
    clearMessage();
    clearUsageStats();
    downloadButton.disabled = true;
    downloadHtmlButton.disabled = true;
    lastMosaicInfo = null;

    if (!file) {
      sourceImage = null;
      sourceFileName = "";
      sourceStatus.textContent = "元画像：未選択";
      return;
    }

    try {
      setWorking(true, "元画像を読み込み中...");
      sourceImage = await loadImageFromFile(file);
      sourceFileName = file.name;
      sourceStatus.textContent = `元画像：${sourceFileName}`;
      showMessage("元画像を読み込みました。", "success");
    } catch (error) {
      sourceImage = null;
      sourceFileName = "";
      sourceStatus.textContent = "元画像：読み込みに失敗しました";
      showMessage("元画像を読み込めませんでした。別の画像でお試しください。", "error");
    } finally {
      setWorking(false);
    }
  }

  async function handleTileChange(event) {
    const allFiles = Array.from(event.target.files || []);
    clearMessage();
    clearUsageStats();
    downloadButton.disabled = true;
    downloadHtmlButton.disabled = true;
    lastMosaicInfo = null;
    tileLibrary = [];
    updateTileStatus();

    if (allFiles.length === 0) {
      return;
    }

    const files = allFiles.slice(0, MAX_TILE_IMAGES);
    if (allFiles.length > MAX_TILE_IMAGES) {
      showMessage(
        "素材写真が多いため、最初の1000枚だけを読み込みます。スマホの場合は300枚程度までをおすすめします。",
        "error"
      );
    }

    try {
      setWorking(true, `素材写真を読み込み中 0 / ${files.length}`);

      for (let index = 0; index < files.length; index += 1) {
        const tile = await createTileThumbnail(files[index], index);
        tileLibrary.push(tile);

        if ((index + 1) % 10 === 0 || index + 1 === files.length) {
          showMessage(`素材写真を読み込み中 ${index + 1} / ${files.length}`);
          updateTileStatus();
          await waitForPaint();
        }
      }

      updateTileStatus();
      const tileImages = tileLibrary;
      console.log("loaded tile images:", tileImages.length);
      showMessage("素材写真を読み込みました。", "success");
    } catch (error) {
      tileLibrary = [];
      updateTileStatus();
      showMessage("素材写真の読み込み中にエラーが起きました。枚数を減らしてお試しください。", "error");
    } finally {
      setWorking(false);
    }
  }

  async function generateMosaic() {
    if (isWorking) {
      return;
    }

    if (!sourceImage) {
      showMessage("先に元画像を1枚選んでください。", "error");
      return;
    }

    if (tileLibrary.length === 0) {
      showMessage("素材写真を1枚以上選んでください。", "error");
      return;
    }

    try {
      setWorking(true, "モザイク生成中...");
      downloadButton.disabled = true;
      downloadHtmlButton.disabled = true;
      lastMosaicInfo = null;

      const outputWidth = getSelectedNumber("outputWidth");
      const tileSize = getSelectedNumber("tileSize");
      const selectionMode = getSelectedValue("selectionMode");
      const overlayAlpha = Number(overlayInput.value) / 100;
      const outputHeight = Math.max(1, Math.round(outputWidth * sourceImage.height / sourceImage.width));

      canvas.width = outputWidth;
      canvas.height = outputHeight;

      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = outputWidth;
      sourceCanvas.height = outputHeight;
      const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
      sourceCtx.drawImage(sourceImage, 0, 0, outputWidth, outputHeight);

      ctx.clearRect(0, 0, outputWidth, outputHeight);

      const totalColumns = Math.ceil(outputWidth / tileSize);
      const totalRows = Math.ceil(outputHeight / tileSize);
      const totalTiles = totalColumns * totalRows;
      const selectedTileGrid = Array.from({ length: totalRows }, () => Array(totalColumns).fill(null));
      let completedTiles = 0;

      resetTileUsage();

      for (let row = 0; row < totalRows; row += 1) {
        const y = row * tileSize;

        for (let column = 0; column < totalColumns; column += 1) {
          const x = column * tileSize;
          const width = Math.min(tileSize, outputWidth - x);
          const height = Math.min(tileSize, outputHeight - y);
          const leftTileId = column > 0 ? selectedTileGrid[row][column - 1] : null;
          const topTileId = row > 0 ? selectedTileGrid[row - 1][column] : null;
          const averageColor = getAverageColor(sourceCtx, x, y, width, height);
          const bestTile = findBestTile(averageColor, selectionMode, leftTileId, topTileId);
          selectedTileGrid[row][column] = bestTile.id;
          bestTile.usedCount += 1;
          ctx.drawImage(bestTile.image, x, y, width, height);

          completedTiles += 1;
          if (completedTiles % YIELD_EVERY_TILES === 0) {
            showMessage(`モザイク生成中... ${completedTiles} / ${totalTiles}`);
            await waitForPaint();
          }
        }
      }

      if (overlayAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = overlayAlpha;
        ctx.drawImage(sourceCanvas, 0, 0);
        ctx.restore();
      }

      canvas.classList.add("has-image");
      emptyPreview.classList.add("hidden");
      previewSize.textContent = `${outputWidth}px x ${outputHeight}px`;
      lastMosaicInfo = getMosaicInfo({
        outputWidth,
        outputHeight,
        tileSize,
        overlayPercent: Number(overlayInput.value),
        selectionMode
      });
      downloadButton.disabled = false;
      downloadHtmlButton.disabled = false;
      updateUsageStats();
      const tileImages = tileLibrary;
      console.table(tileImages.map((tile) => ({
        id: tile.id,
        usedCount: tile.usedCount,
        averageColor: tile.averageColor
      })));
      showMessage("フォトモザイク画像ができました。", "success");
    } catch (error) {
      showMessage("生成中にエラーが起きました。素材写真の枚数や出力サイズを調整してください。", "error");
    } finally {
      setWorking(false);
    }
  }

  function createTileThumbnail(file, id) {
    return loadImageFromFile(file).then((image) => {
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = THUMBNAIL_SIZE;
      tileCanvas.height = THUMBNAIL_SIZE;
      const tileCtx = tileCanvas.getContext("2d", { willReadFrequently: true });
      drawCroppedImage(tileCtx, image, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
      const averageColor = getAverageColor(tileCtx, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);

      return {
        id,
        image: tileCanvas,
        averageColor,
        usedCount: 0
      };
    });
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image load failed"));
      };

      image.src = url;
    });
  }

  function drawCroppedImage(targetCtx, image, x, y, width, height) {
    const sourceSize = Math.min(image.width, image.height);
    const sourceX = Math.floor((image.width - sourceSize) / 2);
    const sourceY = Math.floor((image.height - sourceSize) / 2);

    targetCtx.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      x,
      y,
      width,
      height
    );
  }

  function getAverageColor(targetCtx, x, y, width, height) {
    const imageData = targetCtx.getImageData(x, y, width, height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;

    for (let index = 0; index < imageData.length; index += 4) {
      const alpha = imageData[index + 3] / 255;
      r += imageData[index] * alpha;
      g += imageData[index + 1] * alpha;
      b += imageData[index + 2] * alpha;
      count += alpha;
    }

    if (count === 0) {
      return { r: 255, g: 255, b: 255 };
    }

    return {
      r: r / count,
      g: g / count,
      b: b / count
    };
  }

  function findBestTile(color, selectionMode, leftTileId, topTileId) {
    const usagePenalty = selectionMode === "balanced" ? 3000 : 600;
    const candidates = tileLibrary
      .map((tile) => {
        const colorDistance = getColorDistance(color, tile.averageColor);
        return {
          tile,
          colorDistance,
          score: colorDistance + tile.usedCount * usagePenalty
        };
      })
      .sort((a, b) => a.colorDistance - b.colorDistance);

    const scoredCandidates = selectionMode === "balanced"
      ? getBalancedCandidates(candidates)
      : candidates.sort((a, b) => a.score - b.score);

    const nonNeighborCandidate = scoredCandidates.find((candidate) => (
      candidate.tile.id !== leftTileId && candidate.tile.id !== topTileId
    ));

    return (nonNeighborCandidate || scoredCandidates[0]).tile;
  }

  function getBalancedCandidates(candidates) {
    const smallSetThreshold = 16;
    const candidateLimit = tileLibrary.length <= smallSetThreshold
      ? tileLibrary.length
      : Math.max(4, Math.ceil(tileLibrary.length * 0.45));
    const colorCandidates = candidates.slice(0, candidateLimit);

    return colorCandidates.sort((a, b) => {
      if (a.tile.usedCount !== b.tile.usedCount) {
        return a.tile.usedCount - b.tile.usedCount;
      }

      return a.colorDistance - b.colorDistance;
    });
  }

  function getColorDistance(colorA, colorB) {
    const dr = colorA.r - colorB.r;
    const dg = colorA.g - colorB.g;
    const db = colorA.b - colorB.b;
    return dr * dr + dg * dg + db * db;
  }

  function updateOverlayLabel() {
    overlayValue.textContent = overlayInput.value;
  }

  function updateTileStatus() {
    const count = tileLibrary.length;
    tileStatus.textContent = count > 0 ? `素材写真：${count}枚読み込み済み` : "素材写真：0枚";
    tileGuidance.classList.toggle("warning", count >= 500);

    if (count === 0) {
      tileGuidance.textContent = "100枚以下：快適に処理できます";
    } else if (count < 8) {
      tileGuidance.textContent = "素材写真が少ないため、同じ写真が繰り返し使われます";
    } else if (count <= 100) {
      tileGuidance.textContent = "100枚以下：快適に処理できます";
    } else if (count < 300) {
      tileGuidance.textContent = "推奨素材写真数は300枚までです";
    } else if (count < 500) {
      tileGuidance.textContent = "300枚以上：処理に少し時間がかかる場合があります";
    } else if (count < 1000) {
      tileGuidance.textContent = "500枚以上：スマホでは重くなる可能性があります";
    } else {
      tileGuidance.textContent =
        "1000枚以上：PC推奨です。素材写真が多いため、処理に時間がかかる場合があります。スマホの場合は300枚程度までをおすすめします。";
    }
  }

  function resetApp() {
    sourceImage = null;
    sourceFileName = "";
    tileLibrary = [];
    sourceInput.value = "";
    tileInput.value = "";
    overlayInput.value = "20";
    document.querySelector('input[name="tileSize"][value="20"]').checked = true;
    document.querySelector('input[name="outputWidth"][value="1000"]').checked = true;
    document.querySelector('input[name="selectionMode"][value="balanced"]').checked = true;
    lastMosaicInfo = null;
    updateOverlayLabel();
    updateTileStatus();
    sourceStatus.textContent = "元画像：未選択";
    canvas.width = 0;
    canvas.height = 0;
    canvas.classList.remove("has-image");
    emptyPreview.classList.remove("hidden");
    previewSize.textContent = "まだ生成されていません";
    downloadButton.disabled = true;
    downloadHtmlButton.disabled = true;
    clearMessage();
    clearUsageStats();
  }

  function downloadMosaic() {
    if (!canvas.width || !canvas.height) {
      return;
    }

    const link = document.createElement("a");
    link.download = "photo-mosaic.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function downloadMosaicHtml() {
    if (!canvas.width || !canvas.height || !lastMosaicInfo) {
      return;
    }

    const html = createMosaicHtml(canvas.toDataURL("image/png"), lastMosaicInfo);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = "photo-mosaic.html";
    link.href = url;
    link.click();

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function getSelectedNumber(name) {
    const selected = document.querySelector(`input[name="${name}"]:checked`);
    return Number(selected.value);
  }

  function getSelectedValue(name) {
    const selected = document.querySelector(`input[name="${name}"]:checked`);
    return selected.value;
  }

  function resetTileUsage() {
    for (const tile of tileLibrary) {
      tile.usedCount = 0;
    }
  }

  function updateUsageStats() {
    const info = lastMosaicInfo || getMosaicInfo();
    if (!lastMosaicInfo) {
      lastMosaicInfo = info;
    }

    usageStats.innerHTML = [
      `<span>使用された素材写真：${info.usedTileCount} / ${info.totalTileCount}枚</span>`,
      `<span>もっとも多く使われた写真：${info.maxUsedCount}回</span>`,
      `<span>使われなかった写真：${info.unusedTileCount}枚</span>`
    ].join("");
    usageStats.classList.add("visible");
  }

  function getMosaicInfo(details) {
    const usedTiles = tileLibrary.filter((tile) => tile.usedCount > 0);
    const maxUsedCount = tileLibrary.reduce((max, tile) => Math.max(max, tile.usedCount), 0);
    const unusedCount = tileLibrary.length - usedTiles.length;

    return {
      createdAt: new Date(),
      usedTileCount: usedTiles.length,
      totalTileCount: tileLibrary.length,
      unusedTileCount: unusedCount,
      maxUsedCount,
      outputWidth: details && details.outputWidth ? details.outputWidth : canvas.width,
      outputHeight: details && details.outputHeight ? details.outputHeight : canvas.height,
      tileSize: details && details.tileSize ? details.tileSize : getSelectedNumber("tileSize"),
      overlayPercent: details && typeof details.overlayPercent === "number"
        ? details.overlayPercent
        : Number(overlayInput.value),
      selectionMode: details && details.selectionMode ? details.selectionMode : getSelectedValue("selectionMode")
    };
  }

  function clearUsageStats() {
    usageStats.textContent = "";
    usageStats.classList.remove("visible");
  }

  function createMosaicHtml(imageDataUrl, info) {
    const createdAt = formatDateTime(info.createdAt);
    const selectionModeLabel = info.selectionMode === "balanced" ? "バランス優先" : "色を優先";

    return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>フォトモザイク作品 - 写真つぶつぶアートくん</title>
    <style>
      :root {
        --cream: #f7f0dc;
        --paper: #fffaf0;
        --ink: #3f3a2d;
        --muted: #756f5f;
        --olive: #6f7d3d;
        --olive-dark: #4f5d29;
        --line: #d8caa5;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--ink);
        background: var(--cream);
        font-family: "Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", system-ui, sans-serif;
        line-height: 1.7;
      }

      main {
        width: min(980px, calc(100% - 28px));
        margin: 0 auto;
        padding: 28px 0 36px;
      }

      .series {
        margin: 0 0 6px;
        color: var(--olive-dark);
        font-weight: 700;
      }

      h1 {
        margin: 0 0 18px;
        color: var(--olive-dark);
        font-size: clamp(2rem, 7vw, 4rem);
        line-height: 1.08;
        letter-spacing: 0;
      }

      .card {
        padding: 18px;
        border: 2px solid var(--line);
        border-radius: 8px;
        background: var(--paper);
      }

      img {
        display: block;
        width: 100%;
        height: auto;
        margin: 0 auto;
        border-radius: 8px;
      }

      dl {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 18px;
        margin: 18px 0 0;
      }

      div.meta-item {
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fffdf6;
      }

      dt {
        color: var(--muted);
        font-size: 0.86rem;
        font-weight: 700;
      }

      dd {
        margin: 2px 0 0;
        font-weight: 800;
      }

      .notice {
        margin-top: 16px;
        padding: 12px 14px;
        border: 2px dashed var(--olive);
        border-radius: 8px;
        color: var(--olive-dark);
        font-weight: 700;
      }

      @media (max-width: 620px) {
        main {
          width: min(100% - 20px, 620px);
          padding-top: 18px;
        }

        dl {
          grid-template-columns: 1fr;
        }
      }

      @media print {
        body {
          background: #fff;
        }

        main {
          width: 100%;
          padding: 0;
        }

        .card,
        .notice {
          break-inside: avoid;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="series">写真つぶつぶアートくん</p>
      <h1>フォトモザイク作品</h1>
      <section class="card">
        <img src="${imageDataUrl}" alt="完成したフォトモザイク画像">
        <dl>
          ${createMetaItem("作成日時", createdAt)}
          ${createMetaItem("使用された素材写真数", `${info.usedTileCount}枚`)}
          ${createMetaItem("素材写真の総数", `${info.totalTileCount}枚`)}
          ${createMetaItem("使われなかった写真の枚数", `${info.unusedTileCount}枚`)}
          ${createMetaItem("もっとも多く使われた写真", `${info.maxUsedCount}回`)}
          ${createMetaItem("タイルサイズ", `${info.tileSize}px`)}
          ${createMetaItem("元画像の重ね具合", `${info.overlayPercent}%`)}
          ${createMetaItem("出力サイズ", `${info.outputWidth}px x ${info.outputHeight}px`)}
          ${createMetaItem("素材の使い方", selectionModeLabel)}
        </dl>
      </section>
      <p class="notice">
        このHTMLはブラウザ内で生成されました。元画像・素材写真は外部送信されていません。
      </p>
    </main>
  </body>
</html>`;
  }

  function createMetaItem(label, value) {
    return `<div class="meta-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  }

  function formatDateTime(date) {
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setWorking(working, message) {
    isWorking = working;
    sourceInput.disabled = working;
    tileInput.disabled = working;
    generateButton.disabled = working;
    resetButton.disabled = working;
    downloadHtmlButton.disabled = working || !lastMosaicInfo;

    if (working) {
      generateButton.textContent = "生成中...";
      if (message) {
        showMessage(message);
      }
    } else {
      generateButton.textContent = "フォトモザイクを生成";
    }
  }

  function showMessage(text, type) {
    messageArea.textContent = text;
    messageArea.className = "message-area";

    if (type) {
      messageArea.classList.add(type);
    }
  }

  function clearMessage() {
    messageArea.textContent = "";
    messageArea.className = "message-area";
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
})();
