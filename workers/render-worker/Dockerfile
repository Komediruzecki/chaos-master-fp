FROM denoland/deno:2.8.3

WORKDIR /app

COPY src/ ./src/
COPY deno.json .

EXPOSE 8787

CMD ["run", "--allow-net", "--allow-env", "--allow-read", "src/server.ts"]
