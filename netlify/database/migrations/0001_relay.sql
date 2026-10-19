-- Online play relay: the two clients of a room exchange protocol messages through this table (see src/net/relayServer.ts).
CREATE TABLE relay_messages (
  id bigserial PRIMARY KEY,
  code text NOT NULL,
  sender text NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX relay_messages_code_id ON relay_messages (code, id);
CREATE INDEX relay_messages_created ON relay_messages (created_at);

-- Who is in a room: each poll refreshes seen_at.
CREATE TABLE relay_presence (
  code text NOT NULL,
  client_id text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, client_id)
);
