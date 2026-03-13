cmake_minimum_required(VERSION 3.22.1)
project(document_scanner)

# ─── 1. Encontrar OpenCV via Prefab ──────────────────────────────────────────
# El AAR org.opencv:opencv:4.10.0 expone un único target Prefab: OpenCV::opencv_java4
# que contiene core, imgproc y el resto del SDK dentro de la .so monolítica.
find_package(OpenCV REQUIRED)

# ─── 2. Incluir el código C++ compartido ─────────────────────────────────────
set(SHARED_DIR ${CMAKE_SOURCE_DIR}/../../../../shared)

# ─── 3. Definir la librería nativa ───────────────────────────────────────────
add_library(
    document_scanner
    SHARED
    jni_bridge.cpp
    ${SHARED_DIR}/document_detector.cpp
)

# ─── 4. Incluir paths ────────────────────────────────────────────────────────
target_include_directories(document_scanner PRIVATE
    ${SHARED_DIR}
)

# ─── 5. Enlazar con OpenCV y librerías del sistema ───────────────────────────
target_link_libraries(document_scanner
    OpenCV::opencv_java4
    log
    android
)

# ─── 6. Estándar C++ + soporte para páginas de 16KB (Android 15, Pixel 9+) ──
set_target_properties(document_scanner PROPERTIES
    CXX_STANDARD 17
    CXX_STANDARD_REQUIRED ON
)

target_link_options(document_scanner PRIVATE "-Wl,-z,max-page-size=16384")
