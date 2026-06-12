import { getInitials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

interface AvatarProps {
  name: string | null;
  email?: string | null;
  /** Google profile image URL, or null for the initials fallback. */
  image: string | null;
  /** Size + layout classes for the outer circle (default 28px). */
  className?: string;
  /** Font sizing for the initials fallback. */
  textClassName?: string;
}

/**
 * Circular user avatar: renders the Google profile image when present,
 * otherwise an initials fallback derived from the name/email.
 */
export function Avatar({
  name,
  email = null,
  image,
  className,
  textClassName,
}: AvatarProps) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-success/15 font-medium text-success",
        className
      )}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className={cn("text-[11px]", textClassName)}>
          {getInitials(name, email)}
        </span>
      )}
    </span>
  );
}
