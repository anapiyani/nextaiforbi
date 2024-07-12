// get request returns the key if needed
export async function GET(req: Request) {
  return new Response(
    JSON.stringify({
      key: "d29ua2Fpa3pAZ21haWwuY29t:HODLCo8O88O9z0rnBj2PV",
      url: "https://api.d-id.com",
      service: "talks",
      elevenlabs_key: "a93039384fc501f3163f71a114470127",
      voice_id: "RYxpXk0zQ6S6YSvJH7Uq",
    })
  );
}
