FROM golang:1.25-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .

RUN go test -tags chaos -c -o /chaos-test ./tests/chaos/

FROM alpine:3.21

RUN apk add --no-cache bash

COPY --from=builder /chaos-test /chaos-test

ENV CHAOS_LOOP=1
ENV CHAOS_EVENTS=500
ENV CHAOS_OUTPUT_DIR=/output
ENV CHAOS_SANDBOXED=1

VOLUME /output

ENTRYPOINT ["/chaos-test", "-test.run", "TestChaosLoop", "-test.v", "-test.timeout", "0"]
