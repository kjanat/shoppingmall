#!/usr/bin/env sh
set -eu

# Both host bind mounts carry their own ownership. The server writes downloaded
# audio to the media directory and SQLite state to the private data directory.
music_dir=/app/public/dj-music
if [ -d "${music_dir}" ]; then
	chown mall:mall "${music_dir}"
fi

data_dir=/app/data/dj
if [ -L "${data_dir}" ]; then
	echo "${data_dir} must not be a symlink" >&2
	exit 1
fi
mkdir -p "${data_dir}"
chown mall:mall /app/data "${data_dir}"
for file in "${data_dir}"/library.sqlite "${data_dir}"/library.sqlite-shm "${data_dir}"/library.sqlite-wal; do
	if [ -L "${file}" ]; then
		echo "${file} must not be a symlink" >&2
		exit 1
	fi
	[ ! -e "${file}" ] || chown mall:mall "${file}"
done

exec su-exec mall:mall "$@"
