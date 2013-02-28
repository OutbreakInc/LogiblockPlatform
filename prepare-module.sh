#!/bin/sh

# from the IDE root directory, find all files, remove those on the specified blacklist and use cpio (rather than tar) to create a clean tar file to pipe through gzip.
#   the resulting tar.gz can be uploaded to moduleverse or otherwise distributed.
find . | grep -v -E "/\.|/examples|/test|/tests|\./prepare-module\.sh" | cpio -o --format ustar | gzip -8 > ../platform.release.tar.gz
