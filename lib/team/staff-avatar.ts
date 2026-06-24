type StaffAvatarSeed = {
  id: string;
  email?: string;
  fullName?: string;
  /** Uploaded profile photo; takes priority over the generated avatar. */
  photoUrl?: string | null;
};

/**
 * Resolves the avatar to show for a staff member. An uploaded profile photo
 * (http/https) wins; otherwise we fall back to a generated Dicebear avatar that
 * matches the Team page staff cards.
 */
export function staffAvatarUrl(member: StaffAvatarSeed): string {
  const photo = member.photoUrl?.trim();
  if (photo && (photo.startsWith("http://") || photo.startsWith("https://"))) {
    return photo;
  }
  const seed = encodeURIComponent(
    member.id || member.email || member.fullName || "staff",
  );
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}
