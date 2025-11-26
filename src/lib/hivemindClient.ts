const HIVE_API_URL = process.env.NEXT_PUBLIC_HIVE_API_URL!;

export async function callMeeraHiveMind(userId: string, userMessage: string) {
  const res = await fetch(`${HIVE_API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      user_message: userMessage,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HiveMind error ${res.status}: ${text}`);
  }

  return res.json() as Promise<{
    response: string;
    intent?: string;
    memory_ids?: string[];
  }>;
}
