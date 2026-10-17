export const cloudEnabled = process.env.NEXT_PUBLIC_CLOUD_MODE === "true";
let presenterCode: string | null = null;

export function setPresenterCode(code: string | null) {
  presenterCode = code;
}

export async function authorization(): Promise<string | null> {
  if (cloudEnabled) {
    if (!presenterCode) throw new Error("Unlock presenter access at the top of the page before making changes.");
    return presenterCode;
  }
  return null;
}
