#!/usr/bin/env sh
set -eu

# The private DJ data bind mount holds both SQLite state and downloaded audio.
data_dir=/app/data/dj
if [ -L "${data_dir}" ]; then
	echo "${data_dir} must not be a symlink" >&2
	exit 1
fi
music_dir="${data_dir}/music"
if [ -L "${music_dir}" ]; then
	echo "${music_dir} must not be a symlink" >&2
	exit 1
fi
mkdir -p "${music_dir}"
chown mall:mall /app/data "${data_dir}" "${music_dir}"
for file in "${data_dir}"/library.sqlite "${data_dir}"/library.sqlite-shm "${data_dir}"/library.sqlite-wal; do
	if [ -L "${file}" ]; then
		echo "${file} must not be a symlink" >&2
		exit 1
	fi
	[ ! -e "${file}" ] || chown mall:mall "${file}"
done

exec su-exec mall:mall "$@"
