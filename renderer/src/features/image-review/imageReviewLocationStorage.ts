export const IMAGE_REVIEW_LOCATION_STORAGE_KEY = "forart.image-review.location.v1";

export interface ImageReviewLocation {
  rootPath: string;
  productId: string;
}

const EMPTY_IMAGE_REVIEW_LOCATION: ImageReviewLocation = {
  rootPath: "",
  productId: "",
};

export function readImageReviewLocation(storage: Pick<Storage, "getItem"> = window.localStorage): ImageReviewLocation {
  try {
    const parsed = JSON.parse(storage.getItem(IMAGE_REVIEW_LOCATION_STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return EMPTY_IMAGE_REVIEW_LOCATION;
    return {
      rootPath: typeof parsed.rootPath === "string" ? parsed.rootPath.trim() : "",
      productId: typeof parsed.productId === "string" ? parsed.productId.trim() : "",
    };
  } catch {
    return EMPTY_IMAGE_REVIEW_LOCATION;
  }
}

export function saveImageReviewLocation(
  location: ImageReviewLocation,
  storage: Pick<Storage, "setItem"> = window.localStorage,
) {
  try {
    storage.setItem(IMAGE_REVIEW_LOCATION_STORAGE_KEY, JSON.stringify({
      rootPath: location.rootPath.trim(),
      productId: location.productId.trim(),
    }));
  } catch {
    // The review page remains usable when browser storage is unavailable.
  }
}
