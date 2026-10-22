// Only server-verified, newly created, confirmed accounts qualify as registrations.
// Returning sign-ins and guest sessions must never become signup conversions.
export function isNewRegistration(
  user: {
    created_at: string;
    last_sign_in_at?: string;
    email_confirmed_at?: string | null;
    is_anonymous?: boolean;
  },
  now = Date.now(),
): boolean {
  if (user.is_anonymous || !user.email_confirmed_at) return false;
  const created = Date.parse(user.created_at);
  const signedIn = Date.parse(user.last_sign_in_at ?? '');
  return (
    Number.isFinite(created) &&
    Number.isFinite(signedIn) &&
    created <= now &&
    now - created <= 5 * 60_000 &&
    signedIn >= created &&
    signedIn - created <= 60_000
  );
}

export const META_REGISTRATION_PENDING_KEY = 'meera:meta-registration:v1';
