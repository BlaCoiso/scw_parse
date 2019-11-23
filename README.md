# scw_parse
This is a node.js library for parsing .scw (SC3D) files from Brawl Stars and also export them into .dae (COLLADA) models.
The code is licensed under [GPL v3.0](LICENSE.txt). Read [LICENSE.txt](LICENSE.txt) for the terms and conditions of this license.

## Usage

### Setting up

Clone the repo using `git clone` then make sure you have node.js installed.
```js
const SC3D = require("./SC3D");
SC3D.importPath = "/path/to/sc3d/folder";
```

### Using convert.js
Use `node convert --help` for help with using the convert.js script.

Example: `node convert --source /path/to/sc3d/folder --output /path/to/output/folder --all`

### Importing a library

```js
const lib1 = SC3D.importLib("file1.scw");
```

### Exporting a model

```js
const lib2 = SC3D.importLib("file2.scw");
const model = SC3D.importLib("another_file.scw");
// Libraries are optional, the contents will be merged into the same model
const modelXML = model.exportModel([lib1, lib2]);
// modelXML is a string and can be saved into a .dae using the fs API
```

## Currently unimplemented
 - Animations
 - Full material support (lightmaps, etc)
 - .sc textures
 - Encoding and generating .scw from a model
 - Modifying .scw (adding chunks, editing values)
 - Support older SC3D versions (version 0 and 1)