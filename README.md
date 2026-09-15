# data-proxy

data intercept framework

## Generate the CA

The proxy signs a leaf certificate per domain with a local Certificate
Authority. The CA files must live in `storage/ca/` as `data-proxy.crt` and
`data-proxy.key` (this is where `CertManager` reads them from).

```bash
# private key (no password)
openssl genrsa -out storage/ca/data-proxy.key 2048

# self-signed CA cert with v3 extensions
# keep it at 397 days or fewer — iOS/macOS reject longer-lived certs
openssl req -x509 -new -nodes \
    -key storage/ca/data-proxy.key \
    -sha256 -days 365 \
    -reqexts v3_req -extensions v3_ca \
    -out storage/ca/data-proxy.crt \
    -subj "/C=BR/ST=PR/L=Seyfland/O=data-proxy/CN=data-proxy"
```

Regenerating the CA invalidates every previously issued leaf cert, so it must
be re-installed on every client device afterwards.

## Install the CA on clients

Install `storage/ca/data-proxy.crt` as a trusted root on the client device.
Clients can download it over HTTP from the proxy host on port `3000` (the HTTP
proxy serves `storage/ca/` there).
