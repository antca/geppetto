FROM denoland/deno:1.32.3 AS build-env

WORKDIR /app
COPY . .

RUN deno task build

FROM denoland/deno:1.32.3

COPY --from=build-env /app/build/geppetto /usr/local/bin/

ARG UID=1000
ARG GID=1000

RUN apt update && apt install -y sudo curl jq

RUN groupadd -g $GID geppetto && \
    useradd -u $UID -g $GID --create-home -s /bin/bash geppetto && \
    chown geppetto:geppetto $DENO_DIR && \
    echo '%sudo ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers && \
    usermod -aG sudo geppetto

USER geppetto

WORKDIR /home/geppetto

ENV SHELL=/bin/bash

ENTRYPOINT ["/usr/local/bin/geppetto"]
