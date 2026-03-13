# rn-document-scanner.podspec
require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "rn-document-scanner"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/luisgarciainswitch/rn-document-scanner"
  s.license      = "MIT"
  s.authors      = { "Luis Garcia" => "luisfernando.garcia@inswitch.com" }

  s.platform     = :ios, "13.0"

  s.source       = { :path => "." }

  # Incluir los archivos fuente: módulo ObjC++ y el código C++ compartido
  s.source_files  = "ios/**/*.{h,m,mm}", "shared/**/*.{h,cpp}"

  s.public_header_files = "ios/**/*.h"

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "CLANG_CXX_LIBRARY"           => "libc++",
    "HEADER_SEARCH_PATHS"         => "$(PODS_TARGET_SRCROOT)/shared",
    "OTHER_LDFLAGS"               => "-Wl,-no_compact_unwind"
  }

  # FastOpenCV-iOS: prebuilt opencv2.xcframework for iOS (CocoaPods trunk)
  s.dependency "FastOpenCV-iOS"

  s.dependency "React-Core"
end
