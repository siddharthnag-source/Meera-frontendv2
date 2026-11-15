import { MEERA_WELCOME } from "@/lib/onboarding-reflection";
export default function ChatHandoff() {
  const destination = new URL(process.env.ONBOARDING_WORKSPACE_URL || "https://www.himeera.com/");
  destination.searchParams.set("welcome", "onboarding");
  return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",padding:32,background:"var(--background)",color:"var(--primary)"}}><section style={{maxWidth:520}}><p>MEERA</p><h1 style={{fontFamily:"Georgia,serif",fontWeight:400}}>A little space for you.</h1><p style={{lineHeight:1.8}}>{MEERA_WELCOME}</p><p style={{fontSize:13,opacity:.65}}>This preview contains onboarding. Continue in your Meera workspace to chat. Your plan and access stay the same.</p><a href={destination.toString()}>Open Meera →</a></section></main>;
}
