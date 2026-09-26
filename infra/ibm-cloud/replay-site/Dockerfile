# @file      infra/ibm-cloud/replay-site/Dockerfile
# @phase     P14
# @owner     Product & Experience
# @purpose   Serves the static read-only replay Control Center (public demo URL) on IBM Cloud Code Engine, port 8080.
# @agentNotes site/ is produced by `pnpm demo:replay` (gitignored). Unprivileged nginx listens on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY default.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
EXPOSE 8080
