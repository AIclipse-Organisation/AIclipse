export async function GET() {
  const res = await fetch(
    `${process.env.GATEWAY_URI}/community/images`,
    { cache: "no-store" }
  );

  return new Response(await res.text(), {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
    },
  });
}
