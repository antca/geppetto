FROM denoland/deno:1.30.3

ARG UID=1000
ARG GID=1000

RUN apt update && apt install -y sudo curl pup jq lynx

RUN groupadd -g $GID geppetto && \
    useradd -u $UID -g $GID --create-home -s /bin/bash geppetto && \
    chown geppetto:geppetto $DENO_DIR && \
    echo '%sudo ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers && \
    usermod -aG sudo geppetto

COPY . /app

WORKDIR /app

RUN deno task cache

RUN chown -R geppetto:geppetto /app

USER geppetto

CMD ["task", "start"]
