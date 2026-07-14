// Beskär en bild i webbläsaren utifrån pixel-arean från react-easy-crop och
// returnerar en kvadratisk JPEG som data-URL, redo att förhandsvisas och
// skickas till servern som base64.

export interface CropAreaPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

const OUTPUT_SIZE = 800;

export async function cropImageToDataUrl(imageSrc: string, area: CropAreaPixels): Promise<string> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunde inte skapa canvas för beskärning.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Plockar ut base64-datat ur en data-URL (för uppladdning till servern).
export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bilden kunde inte läsas."));
    img.src = src;
  });
}
