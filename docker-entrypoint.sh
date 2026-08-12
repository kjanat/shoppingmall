#!/usr/bin/env sh
set -eu

# The host bind mount carries its own ownership.
# Repair only its writable boundary; audio already in the library keeps host ownership.
music_dir=/app/public/dj-music
if [ -d "${music_dir}" ]; then
	chown mall:mall "${music_dir}"
	crate_dir="${music_dir}/.mall"
	if [ -L "${crate_dir}" ]; then
		echo "${crate_dir} must not be a symlink" >&2
		exit 1
	fi
	mkdir -p "${crate_dir}"
	chown mall:mall "${crate_dir}"
	for file in "${crate_dir}"/crate.sqlite "${crate_dir}"/crate.sqlite-shm "${crate_dir}"/crate.sqlite-wal; do
		if [ -L "${file}" ]; then
			echo "${file} must not be a symlink" >&2
			exit 1
		fi
		[ ! -e "${file}" ] || chown mall:mall "${file}"
	done
fi

exec su-exec mall:mall "$@"
