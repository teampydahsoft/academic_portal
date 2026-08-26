/**
 * Portal branding for public surfaces (login, etc.).
 * Configure via NEXT_PUBLIC_* env vars — no database master required.
 *
 * College logo = institution branding (configurable per college).
 * App icon = Pydah Academic Portal / PWA branding (product identity).
 */

export type PortalBranding = {
  collegeLogo: string;
  collegeName: string;
  portalName: string;
  /** Full Pydah Academic Portal app icon (PWA / product mark). */
  appIcon: string;
  /** Compact emblem (PY + academic symbol) for small UI chrome. */
  appIconMark: string;
  /** Optional college / group site for the card back control. */
  collegeWebsite?: string;
};

export function getPortalBranding(): PortalBranding {
  return {
    collegeLogo:
      process.env.NEXT_PUBLIC_COLLEGE_LOGO?.trim() || "/branding/college-logo.svg",
    collegeName:
      process.env.NEXT_PUBLIC_COLLEGE_NAME?.trim() || "Pydah Group of Institutions",
    portalName: process.env.NEXT_PUBLIC_PORTAL_NAME?.trim() || "ACADEMIC PORTAL",
    appIcon:
      process.env.NEXT_PUBLIC_APP_ICON?.trim() ||
      "/branding/pydah-academic-portal-icon.png",
    appIconMark:
      process.env.NEXT_PUBLIC_APP_ICON_MARK?.trim() || "/branding/icon-mark.png",
    collegeWebsite: process.env.NEXT_PUBLIC_COLLEGE_WEBSITE?.trim() || undefined,
  };
}
