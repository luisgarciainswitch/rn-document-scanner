// react-native.config.js
// Le dice al CLI de React Native dónde están los módulos nativos
// para que autolinking los encuentre sin configuración manual en la app.
module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.rndocumentscanner.DocumentScannerPackage;',
        packageInstance: 'new DocumentScannerPackage()',
      },
      ios: {
        // El podspec en la raíz es suficiente; autolinking lo encuentra automáticamente
      },
    },
  },
};
