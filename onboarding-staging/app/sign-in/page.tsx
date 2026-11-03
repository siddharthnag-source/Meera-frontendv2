import Link from "next/link";
export default function SignIn() {
  const target = process.env.ONBOARDING_SIGN_IN_URL;
  const valid =
    target &&
    (() => {
      try {
        return new URL(target).protocol === "https:";
      } catch {
        return false;
      }
    })();
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: 24 }}>
      <h1>Continue to your account</h1>
      <p>
        This isolated voice staging project does not connect to your account
        database.
      </p>
      {valid ? (
        <a href={target}>Continue to staging Google sign-up</a>
      ) : (
        <p>Staging account sign-up has not been configured yet.</p>
      )}
      <p>
        <Link href="/onboarding">Back to Meera</Link>
      </p>
    </main>
  );
}
