# scw_parse
This is a node.js library for parsing .scw (SC3D) files from Brawl Stars and also export them into .dae (COLLADA) models.
The code is licensed under [GPL v3.0](LICENSE.txt). Read [LICENSE.txt](LICENSE.txt) for the terms and conditions of this license.

## Usage

### Setting up

```js
const SC3D = require("./SC3D");
SC3D.importPath = "/path/to/sc3d/folder";
```

### Importing a library

```js
const lib1 = SC3D.importLib("lib1");
```

### Exporting a model

```js
const lib2 = SC3D.importLib("lib2");
const model = SC3D.importLib("model");
// Libraries are optional, the contents will be merged into the same model
const modelXML = model.exportModel([lib1, lib2]);
// modelXML can be saved into a .dae
```

## Currently unimplemented
 - Animations
 - Full material support (lightmaps, etc)
 - .sc textures
 - Encoding and generating .scw from a model
 - Modifying .scw (adding chunks, editing values)
 - Support older SC3D versions (version 0 and 1)