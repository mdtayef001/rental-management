/**
 * The business's logo, as an address an `<img>` can load.
 *
 * The version is part of the address, so the browser keeps the picture for good and still
 * shows a new logo the moment one is uploaded. No trailing slash: the route handler adds it
 * before calling Django.
 */
export function logoUrl(version: string | null | undefined) {
  return version ? `/api/backend/business/logo?v=${encodeURIComponent(version)}` : null
}

/** The same logo on the customer's own copy of a receipt, reached with the receipt's token. */
export function publicLogoUrl(token: string, version: string | null | undefined) {
  return version ? `/api/backend/receipts/${encodeURIComponent(token)}/logo?v=${encodeURIComponent(version)}` : null
}

/** The longest side a logo is stored at. Plenty for the top of an A4 sheet at print quality. */
const MAX_SIDE = 600

/**
 * A chosen picture, scaled down and turned into the PNG `data:` URL the server stores.
 *
 * Done in the browser so a 6 MB photo of a signboard never leaves the phone at full size,
 * and so every logo arrives as a plain PNG whatever it started as. PNG keeps a transparent
 * background, which is what lets a logo sit on white paper without a box around it.
 */
export async function prepareLogo(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a picture: PNG or JPG.")
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That picture couldn't be opened. Try a PNG or JPG.")
  })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("This browser can't prepare pictures.")
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL("image/png")
}
