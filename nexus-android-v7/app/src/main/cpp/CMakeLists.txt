cmake_minimum_required(VERSION 3.22.1)
project("nexus-llama" VERSION 2.0.0 LANGUAGES C CXX)

set(CMAKE_C_STANDARD 17)
set(CMAKE_CXX_STANDARD 17)

# Path to the llama.cpp source tree (symlinked into cpp/)
set(LLAMA_SRC ${CMAKE_CURRENT_LIST_DIR}/llama.cpp)

# Build llama.cpp as a subdirectory
add_subdirectory(${LLAMA_SRC} build-llama)

# Build our JNI bridge as a shared library
add_library(nexus_llama SHARED nexus_jni.cpp)

target_include_directories(nexus_llama PRIVATE
    ${LLAMA_SRC}/include
    ${LLAMA_SRC}/common
    ${LLAMA_SRC}/ggml/include
    ${LLAMA_SRC}/vendor
    ${LLAMA_SRC}
)

target_link_libraries(nexus_llama
    llama
    common
    android
    log
)
