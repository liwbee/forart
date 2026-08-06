import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { ImageReviewImage } from "../../app/appConfig";

export const ReviewThumbnail = memo(function ReviewThumbnail({
  image,
  active,
  onSelect,
}: {
  image: ImageReviewImage;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Button
      className={`review-thumb-button${active ? " active" : ""}`}
      type="button"
      variant="outline"
      size="icon"
      aria-label={t("imageReview:viewImage", { name: image.name })}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      <img
        src={image.thumbnailUrl}
        alt=""
        decoding="async"
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        onError={(event) => {
          event.currentTarget.hidden = true;
          event.currentTarget.parentElement?.querySelector(".review-thumb-fallback")?.removeAttribute("hidden");
        }}
      />
      <span className="review-thumb-fallback" hidden aria-hidden="true">
        <ImageOff size={16} />
      </span>
    </Button>
  );
});
