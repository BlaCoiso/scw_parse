/* eslint-disable no-debugger */
/* eslint-env node, es6 */

const XML = require("./XML");
const fs = require("fs");
const MAGIC = "SC3D";
const CRCTable = new Uint32Array(256);
let CRCInitialized = false;

const importMap = new Map();
let importPath = ".";

function computeCRC(data, v) {
    //Fix JS weird signed stuff
    const fix32 = v => v & (1 << 31) ? (v & 0x7FFFFFFF) + 0x80000000 : v;
    if (data instanceof Uint8Array) {
        if (!CRCInitialized) {
            for (let i = 0; i < 256; ++i) {
                let c = i;
                for (let k = 0; k < 8; ++k) {
                    c = (c & 1 ? 0xedb88320 : 0) ^ (c >>> 1);
                }
                CRCTable[i] = fix32(c);
            }
            CRCInitialized = true;
        }
        let c = v || 0xFFFFFFFF;
        for (let i = 0; i < data.length; ++i) {
            c = CRCTable[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
        }
        return fix32(~c);
    }
    return 0;
}

class SC3D {
    /**
     * @param {Buffer} data 
     * @param {string?} name
     */
    constructor(data, name) {
        this.name = name || "unknown";
        this.data = data;
        if (data.compare(Buffer.from(MAGIC), 0, 3, 0, 3)) throw new TypeError("Invalid SC3D file");
        /** @type {SC3DChunk[]} */
        this.chunks = [];
        this.loaded = false;
    }
    load() {
        if (this.loaded) return this;
        let ptr = MAGIC.length;
        while (ptr < this.data.length && !this.findChunk("WEND")) {
            let len = this.data.readUInt32BE(ptr) + 12;
            let chunk = new SC3DChunk(this.data.slice(ptr, ptr + len), this);
            this.chunks.push(chunk.parse());
            ptr += len;
        }

        const leftOver = this.data.length - ptr;
        if (leftOver) console.warn(`ROOT-> ${leftOver} bytes unprocessed`);
        this.loaded = true;
        return this;
    }
    findChunk(name) {
        return this.chunks.find(chk => chk.name === name);
    }
    findChunks(name) {
        return this.chunks.filter(chk => chk.name === name);
    }
    /**
     * Exports a model as a COLLADA XML
     * @param {SC3D?|SC3D[]} libraries List of libraries to include
     */
    exportModel(libraries) {
        const libImages = new XML.Tag("library_images");
        const libEffects = new XML.Tag("library_effects");
        const libMaterials = new XML.Tag("library_materials");
        const libGeometries = new XML.Tag("library_geometries");
        const libControllers = new XML.Tag("library_controllers");
        const libAnimations = new XML.Tag("library_animations");
        const visualScene = new XML.Tag("visual_scene", null, [["id", "Scene"], ["name", "Scene"]]);
        const libVisualScene = new XML.Tag("library_visual_scenes", visualScene);
        const libCameras = new XML.Tag("library_cameras");
        if (libraries instanceof SC3D) libraries.appendToLibrary(
            libImages, libEffects, libMaterials, libGeometries,
            libControllers, libAnimations, visualScene, libCameras
        );
        else if (Array.isArray(libraries)) libraries.filter(lib => lib instanceof SC3D)
            .forEach(lib => lib.appendToLibrary(
                libImages, libEffects, libMaterials, libGeometries,
                libControllers, libAnimations, visualScene, libCameras
            ));
        this.appendToLibrary(
            libImages, libEffects, libMaterials, libGeometries,
            libControllers, libAnimations, visualScene, libCameras
        );

        return new XML(new XML.Tag("COLLADA", [
            new XML.Tag("asset", [
                new XML.Tag("contributor",
                    new XML.Tag("authoring_tool", `SC3D.js [${SC3D.getVersion()}] (BlaCoiso)`)
                ),
                new XML.Tag("created", new Date().toISOString()),
                new XML.Tag("up_axis", "Y_UP")
            ]),
            libImages, libEffects, libMaterials, libGeometries, libControllers, libAnimations, libVisualScene, libCameras,
            new XML.Tag("scene", new XML.Tag("instance_visual_scene", null, new XML.Attribute("url", "#Scene")))
        ], [
            ["xmlns", "http://www.collada.org/2005/11/COLLADASchema"],
            ["version", "1.4.1"],
            ["xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance"]
        ]
        )).generate(true);
    }

    /**
     * Appends this SC3D to a library
     * @param {XML.Tag} libImages 
     * @param {XML.Tag} libEffects 
     * @param {XML.Tag} libMaterials 
     * @param {XML.Tag} libGeometries 
     * @param {XML.Tag} libControllers 
     * @param {XML.Tag} libAnimations 
     * @param {XML.Tag} visualScene 
     * @param {XML.Tag} libCameras 
     */
    appendToLibrary(libImages, libEffects, libMaterials, libGeometries, libControllers, libAnimations, visualScene, libCameras) {
        this.chunks.forEach(c => {
            if (c instanceof SC3DHeader) {
                if (c.library) c.library.appendToLibrary(libImages, libEffects, libMaterials, libGeometries, libControllers, libAnimations, visualScene, libCameras);
            } else if (c instanceof SC3DGeometry) {
                const name = c.geoName;
                const meshTag = new XML.Tag("mesh");

                const sources = [];
                let hasVertices = false;
                let hasNormals = false;
                let hasUVs = false;
                let hasColors = false;
                if (c.props.POSITION) {
                    hasVertices = true;
                    const verts = c.props.POSITION;
                    verts.forEach((vert, i) => sources.push(new XML.Tag("source",
                        [
                            new XML.Tag("float_array",
                                vert.values.map(v => `${v.x} ${v.y} ${v.z}`).join(" "),
                                [["id", name + "-positions-array-" + i], ["count", vert.values.length * 3]]
                            ),
                            new XML.Tag("technique_common",
                                new XML.Tag("accessor", [
                                    new XML.Tag("param", null, [["name", "X"], ["type", "float"]]),
                                    new XML.Tag("param", null, [["name", "Y"], ["type", "float"]]),
                                    new XML.Tag("param", null, [["name", "Z"], ["type", "float"]])
                                ], [["source", '#' + name + "-positions-array-" + i], ["count", vert.values.length], ["stride", 3]])
                            )
                        ], new XML.Attribute("id", name + "-positions-" + i)
                    )));
                }
                if (c.props.NORMAL) {
                    hasNormals = true;
                    const norms = c.props.NORMAL;
                    norms.forEach((norm, i) => sources.push(new XML.Tag("source",
                        [
                            new XML.Tag("float_array",
                                norm.values.map(v => `${v.x} ${v.y} ${v.z}`).join(" "),
                                [["id", name + "-normals-array-" + i], ["count", norm.values.length * 3]]
                            ),
                            new XML.Tag("technique_common",
                                new XML.Tag("accessor", [
                                    new XML.Tag("param", null, [["name", "X"], ["type", "float"]]),
                                    new XML.Tag("param", null, [["name", "Y"], ["type", "float"]]),
                                    new XML.Tag("param", null, [["name", "Z"], ["type", "float"]])
                                ], [["source", '#' + name + "-normals-array-" + i], ["count", norm.values.length], ["stride", 3]])
                            )
                        ], new XML.Attribute("id", name + "-normals-" + i)
                    )));
                }
                if (c.props.TEXCOORD) {
                    hasUVs = true;
                    const texUVs = c.props.TEXCOORD;
                    texUVs.forEach((UV, i) => sources.push(new XML.Tag("source",
                        [
                            new XML.Tag("float_array",
                                UV.values.map(v => `${v.u} ${1 - v.v}`).join(" "),
                                [["id", name + "-uv-array-" + i], ["count", UV.values.length * 2]]
                            ),
                            new XML.Tag("technique_common",
                                new XML.Tag("accessor", [
                                    new XML.Tag("param", null, [["name", "S"], ["type", "float"]]),
                                    new XML.Tag("param", null, [["name", "T"], ["type", "float"]])
                                ], [["source", '#' + name + "-uv-array-" + i], ["count", UV.values.length], ["stride", 2]])
                            )
                        ], new XML.Attribute("id", name + "-texCoords-" + i)
                    )));
                }
                if (c.props.COLOR) {
                    hasColors = true;
                    const colors = c.props.COLOR;
                    colors.forEach((color, i) => sources.push(new XML.Tag("source",
                        [
                            new XML.Tag("float_array",
                                color.values.map(a => `${a.r} ${a.g} ${a.b} ${a.a}`).join(" "),
                                [["id", name + "-colors-array-" + i], ["count", color.values.length * 4]]
                            ),
                            new XML.Tag("technique_common",
                                new XML.Tag("accessor", [
                                    new XML.Tag("param", null, [["name", "R"], ["type", "float"]]),
                                    new XML.Tag("param", null, [["name", "G"], ["type", "float"]]),
                                    new XML.Tag("param", null, [["name", "B"], ["type", "float"]]),
                                    new XML.Tag("param", null, [["name", "A"], ["type", "float"]])
                                ], [["source", '#' + name + "-colors-array-" + i], ["count", color.values.length], ["stride", 4]])
                            )
                        ], new XML.Attribute("id", name + "-colors-" + i)
                    )));
                }
                meshTag.appendChildren(
                    [
                        sources,
                        new XML.Tag("vertices",
                            new XML.Tag("input", null,
                                [["semantic", "POSITION"], ["source", '#' + name + "-positions-0"]]
                            ), new XML.Attribute("id", name + "-vertices")
                        )]
                );
                c.meshes.forEach((m, i) => {
                    const mName = name + '-' + i;
                    const coordID = c.props.TEXCOORD ? i % c.props.TEXCOORD.length : 0;

                    const includeNorms = m.triangles[0].dataA.normal !== undefined && hasNormals;
                    const includeUVs = m.triangles[0].dataA.texture !== undefined && hasUVs;
                    const includeColors = m.triangles[0].dataA.color !== undefined && hasColors;
                    const triTag = new XML.Tag("triangles", null,
                        [["material", m.material], ["count", m.triangles.length], ["name", mName]]
                    );
                    let o = 0;
                    if (hasVertices) triTag.appendChildren(new XML.Tag("input", null,
                        [["semantic", "VERTEX"], ["source", '#' + name + "-vertices-0"], ["offset", o++]]
                    ));
                    if (includeNorms) triTag.appendChildren(new XML.Tag("input", null,
                        [["semantic", "NORMAL"], ["source", '#' + name + "-normals-0"], ["offset", o++]]
                    ));
                    if (includeUVs) triTag.appendChildren(new XML.Tag("input", null,
                        [["semantic", "TEXCOORD"], ["source", '#' + name + "-texCoords-" + coordID], ["offset", o++], ["set", coordID]]
                    ));
                    if (includeColors) triTag.appendChildren(new XML.Tag("input", null,
                        [["semantic", "COLOR"], ["source", '#' + name + "-colors-0"], ["offset", o++]]
                    ));
                    triTag.appendChildren(new XML.Tag("p", m.triangles.map(t => {
                        let tA = [t.A];
                        let tB = [t.B];
                        let tC = [t.C];
                        if (includeNorms) {
                            tA.push(t.dataA.normal);
                            tB.push(t.dataB.normal);
                            tC.push(t.dataC.normal);
                        }
                        if (includeUVs) {
                            tA.push(t.dataA.texture);
                            tB.push(t.dataB.texture);
                            tC.push(t.dataC.texture);
                        }
                        if (includeColors) {
                            tA.push(t.dataA.color);
                            tB.push(t.dataB.color);
                            tC.push(t.dataC.color);
                        }
                        return tA.concat(tB, tC).join(' ');
                    }).join(' ')));
                    //TODO: Figure out what to do with the other tex coord sets
                    meshTag.appendChildren(triTag);
                });
                libGeometries.appendChildren(new XML.Tag("geometry", meshTag, [["id", name], ["name", name]]));
                if (c.joints && c.joints.length) {
                const skinTag = new XML.Tag("skin", null, new XML.Attribute("source", '#' + c.geoName));
                if (c.hasMatrix) skinTag.appendChildren(new XML.Tag("bind_shape_matrix", c.shapeMatrix.join(' ')));
                skinTag.appendChildren(new XML.Tag("source",
                    [
                        new XML.Tag("Name_array",
                            c.joints.map(j => j.name).join(' '),
                            [["id", c.geoName + "-joints-array"], ["count", c.joints.length]]
                        ),
                        new XML.Tag("technique_common",
                            new XML.Tag("accessor",
                                new XML.Tag("param", null, [["name", "JOINT"], ["type", "name"]]),
                                [["source", `#${c.geoName}-joints-array`], ["count", c.joints.length], ["stride", 1]]
                            )
                        )
                    ], new XML.Attribute("id", c.geoName + "-joints")
                ));
                skinTag.appendChildren(new XML.Tag("source",
                    [
                        new XML.Tag("float_array",
                            c.joints.map(j => j.matrix.join(' ')).join(' '),
                            [["id", c.geoName + "-matrices-array"], ["count", c.joints.length * 4 * 4]]
                        ),
                        new XML.Tag("technique_common",
                            new XML.Tag("accessor",
                                new XML.Tag("param", null, [["name", "TRANSFORM"], ["type", ["float4x4"]]]),
                                [["source", `#${c.geoName}-matrices-array`], ["count", c.joints.length], ["stride", 16]]
                            )
                        )
                    ],
                    new XML.Attribute("id", c.geoName + "-matrices")
                ));
                const weights = [];
                const counts = [];
                const weightData = [];
                c.vertexWeights.forEach(w => {
                    let count = 0;
                    let temp = [[w.weightA, w.jointA], [w.weightB, w.jointB], [w.weightC, w.jointC], [w.weightD, w.jointD]];
                    for (const pair of temp) {
                        if (pair[0] === 0) continue;
                        weightData.push(pair[1]);
                        if (weights.includes(pair[0])) weightData.push(weights.indexOf(pair[0]));
                        else weightData.push(weights.push(pair[0]) - 1);
                        ++count;
                    }
                    counts.push(count);
                });
                skinTag.appendChildren(new XML.Tag("source",
                    [
                        new XML.Tag("float_array", weights.join(' '),
                            [["id", c.geoName + "-weights-array"], ["count", weights.length]]
                        ),
                        new XML.Tag("technique_common",
                            new XML.Tag("accessor",
                                new XML.Tag("param", null, [["name", "WEIGHT"], ["type", ["float"]]]),
                                [["source", `#${c.geoName}-weights-array`], ["count", weights.length], ["stride", 1]]
                            )
                        )
                    ],
                    new XML.Attribute("id", c.geoName + "-weights")
                ));
                skinTag.appendChildren(new XML.Tag("joints",
                    [
                        new XML.Tag("input", null, [["semantic", "JOINT"], ["source", `#${c.geoName}-joints`]]),
                        new XML.Tag("input", null, [["semantic", "INV_BIND_MATRIX"], ["source", `#${c.geoName}-matrices`]])
                    ]
                ));
                skinTag.appendChildren(new XML.Tag("vertex_weights",
                    [
                        new XML.Tag("input", null, [["semantic", "JOINT"], ["offset", 0], ["source", `#${c.geoName}-joints`]]),
                        new XML.Tag("input", null, [["semantic", "WEIGHT"], ["offset", 1], ["source", `#${c.geoName}-weights`]]),
                        new XML.Tag("vcount", counts.join(' ')),
                        new XML.Tag("v", weightData.join(' '))
                    ],
                    new XML.Attribute("count", counts.length)
                ));
                libControllers.appendChildren(new XML.Tag("controller", skinTag,
                    [["id", c.geoName + "-cont"], ["name", c.geoName + "-cont"]])
                );
                }
            } else if (c instanceof SC3DNodeList) {
                /**
                 * Adds node data to a tag
                 * @param {SC3DNode} node 
                 * @param {XML.Tag} tag 
                 */
                const addNodeData = (node, tag) => {
                    if (node.frames.length === 0) console.warn(`Node ${node.name} has no frames, skipping transformation data`);
                    else {
                        const nodeFrame = node.frames[0];
                        const pos = nodeFrame.position;
                        const rot = nodeFrame.rotation;
                        const scale = nodeFrame.scale;
                        tag.appendChildren(new XML.Tag("translate", `${pos.x} ${pos.y} ${pos.z}`, new XML.Attribute("sid", "location")));
                        tag.appendChildren(new XML.Tag("rotate", `${rot.x} ${rot.y} ${rot.z} ${rot.w}`, new XML.Attribute("sid", "rotation")));
                        tag.appendChildren(new XML.Tag("scale", `${scale.x} ${scale.y} ${scale.z}`, new XML.Attribute("sid", "scale")));
                    }
                    if (node.hasTarget) {
                        let materials;
                        if (node.targetType === "CONT" || node.targetType === "GEOM") {
                            materials = new XML.Tag("bind_material",
                                new XML.Tag("technique_common",
                                    node.bindings.map(m => new XML.Tag("instance_material", null,
                                        [["symbol", m.symbol], ["target", "#" + m.target]])
                                    )));
                        }
                        if (node.targetType === "CONT") {
                            tag.appendChildren(new XML.Tag("instance_controller",
                                materials,
                                new XML.Attribute("url", '#' + node.targetName + "-cont")));
                        } else if (node.targetType === "GEOM") {
                            tag.appendChildren(new XML.Tag("instance_geometry",
                                materials,
                                new XML.Attribute("url", '#' + node.targetName)));
                        } else if (node.targetType === "CAME") {
                            //TODO: Find out what to do here
                        }
                    }
                    //TODO: Frames
                };
                /**
                 * Recursively adds all node tags
                 * @param {SC3DNode} node 
                 * @param {XML.Tag} parentTag 
                 * @param {boolean} isJoint 
                 */
                const recursiveAddTag = (node, parentTag) => {
                    const children = c.nodes.filter(nc => nc.parent === node.name);
                    const isJoint = !node.hasTarget && !children.find(c => c.hasTarget);
                    const childTag = new XML.Tag("node", null,
                        [["id", node.name], ["name", node.name], ["sid", node.name], ["type", isJoint ? "JOINT" : "NODE"]]
                    );
                    addNodeData(node, childTag);
                    children.forEach(nc => recursiveAddTag(nc, childTag));
                    parentTag.appendChildren(childTag);
                };
                const rootNodes = c.nodes.filter(n => !n.parent && n.name);
                rootNodes.forEach(n => {
                    const nodeTag = new XML.Tag("node", null,
                        [["id", n.name], ["name", n.name], ["sid", n.name], ["type", "NODE"]]
                    );
                    addNodeData(n, nodeTag);
                    c.nodes.filter(nc => nc.parent === n.name).forEach(nc => recursiveAddTag(nc, nodeTag, !nc.hasTarget));
                    visualScene.appendChildren(nodeTag);
                });
            } else if (c instanceof SC3DMaterial) {
                const effectPhongTag = new XML.Tag("phong");
                const effectProfileTag = new XML.Tag("profile_COMMON");
                const effectTag = new XML.Tag("effect", effectProfileTag, new XML.Attribute("id", c.matName + "-effect"));
                let matTexIdx = 0;
                let tempTexName;
                const addTexture = (tex, imgName, addImg) => {
                    let img = imgName;
                    if (!imgName) img = tex.replace(/\.pvr.*$/, ".png");
                    if (!img.endsWith(".png")) img += ".png";
                    effectProfileTag.appendChildren([
                        new XML.Tag("newparam",
                            new XML.Tag("surface",
                                new XML.Tag("init_from", tex),
                                new XML.Attribute("type", "2D")
                            ),
                            new XML.Attribute("sid", tex + "-surface")),
                        new XML.Tag("newparam",
                            new XML.Tag("sampler2D",
                                new XML.Tag("source", tex + "-surface")
                            ),
                            new XML.Attribute("sid", tex + "-sampler"))

                    ]);
                    if (addImg !== false) libImages.appendChildren(new XML.Tag("image",
                        new XML.Tag("init_from", img),
                        [["id", tex], ["name", tex]]
                    ));
                };
                if (c.ambientColor) effectPhongTag.appendChildren(new XML.Tag("ambient",
                    new XML.Tag("color", SC3DMaterial.getRGBA(c.ambientColor).join(' '))
                ));
                else if (c.ambientTexture) {
                    if (c.ambientTexture === '.') {
                        tempTexName = c.matName + "_tex_" + matTexIdx++;
                        addTexture(tempTexName, c.matName + "_tex", matTexIdx === 1);
                        effectPhongTag.appendChildren(new XML.Tag("ambient",
                            new XML.Tag("texture", null, [["texture", tempTexName + "-sampler"], ["texcoord", "UVMap"]])
                        ));
                    } else {
                        addTexture(c.ambientTexture);
                        effectPhongTag.appendChildren(new XML.Tag("ambient",
                            new XML.Tag("texture", null, [["texture", c.ambientTexture + "-sampler"], ["texcoord", "Normal"]])
                        ));
                    }
                }
                if (c.diffuseColor) effectPhongTag.appendChildren(new XML.Tag("diffuse",
                    new XML.Tag("color", SC3DMaterial.getRGBA(c.diffuseColor).join(' '))
                ));
                else if (c.diffuseTexture) {
                    if (c.diffuseTexture === '.') {
                        tempTexName = c.matName + "_tex_" + matTexIdx++;
                        addTexture(tempTexName, c.matName + "_tex", matTexIdx === 1);
                        effectPhongTag.appendChildren(new XML.Tag("diffuse",
                            new XML.Tag("texture", null, [["texture", tempTexName + "-sampler"], ["texcoord", "UVMap"]])
                        ));
                    } else {
                        addTexture(c.diffuseTexture);
                        effectPhongTag.appendChildren(new XML.Tag("diffuse",
                            new XML.Tag("texture", null, [["texture", c.diffuseTexture + "-sampler"], ["texcoord", "Normal"]])
                        ));
                    }
                }
                effectPhongTag.appendChildren(new XML.Tag("index_of_refraction", new XML.Tag("float", "1")))
                effectProfileTag.appendChildren(new XML.Tag("technique", effectPhongTag, new XML.Attribute("sid", "common")));
                libEffects.appendChildren(effectTag);
                libMaterials.appendChildren(new XML.Tag("material",
                    new XML.Tag("instance_effect", null, new XML.Attribute("url", `#${c.matName}-effect`)),
                    [["id", c.matName], ["name", c.matName]]
                ));
                //TODO: Figure out what exactly can be done with the stencil
                //TODO: Figure out more stuff
            } else if (c instanceof SC3DCamera) {
                libCameras.appendChildren(new XML.Tag("camera",
                    new XML.Tag("optics", new XML.Tag("technique_common", new XML.Tag("perspective",
                        [
                            new XML.Tag("xfov", c.xFOV),
                            new XML.Tag("aspect_ratio", c.aspectRatio),
                            new XML.Tag("znear", c.zNear),
                            new XML.Tag("zfar", c.zFar)
                        ]
                    ))),
                    [["id", c.camName], ["name", c.camName]]
                ));
            }
        });
    }

    toString() {
        return `SC3D ${this.name}: ${this.chunks.length} chunks: ` +
            this.chunks.length ? '\n' + this.chunks.map(c => '\t' + c.toString().replace(/\n/g, "\n\t")).join('\n') : "";
    }

    static set importPath(path) {
        importPath = path;
    }

    /**
     * Imports a SC3D library
     * @param {string} name 
     * @returns {SC3D} imported library
     */
    static importLib(name) {
        if (name instanceof SC3D) {
            if (!name.name.endsWith(".scw")) name.name += ".scw";
            if (!importMap.has(name.name)) importMap.set(name.name, name);
            return name.load();
        }
        if (name.startsWith("sc3d/")) return this.importLib(name.replace("sc3d/", ""));
        if (importMap.has(name)) return importMap.get(name);
        else {
            if (!name.endsWith(".scw")) name += ".scw";
            const libPath = importPath + '/' + name;
            if (fs.existsSync(libPath)) {
                const libFile = new SC3D(fs.readFileSync(libPath), name);
                importMap.set(name, libFile);
                libFile.load();
                return libFile;
            } else if (fs.existsSync(importPath + "/sc3d/" + name)) {
                importPath += "/sc3d";
                return this.importLib(name);
            }
            else throw new ReferenceError("Failed to find library " + name);
        }
    }

    static get Chunk() {
        return SC3DChunk;
    }

    static getVersion() {
        if (this.hasVersion && typeof this.version === "string" && this.version) return this.version;
        const { execSync } = require("child_process");
        const execOpts = { cwd: __dirname, windowsHide: true, encoding: "utf8", timeout: 10 * 1000 };
        let version = "unknown-v0.0.2";
        try {
            version = "git-" + execSync("git rev-parse --short=10 HEAD", execOpts).replace(/[\n\r]/g, "");
            version += '-' + execSync("git describe --tags", execOpts).split('\n')[0].replace('\r', "");
        } catch (e) {
            console.error("Failed to read version:", e);
        }
        this.hasVersion = true;
        this.version = version;
        return version;
    }
}

class SC3DChunk {
    constructor(data, container) {
        if (data instanceof SC3DChunk) {
            /** @type {string} */
            this.name = data.name;
            /** @type {number} */
            this.length = data.length;
            /** @type {Buffer} */
            this.data = data.data;
            /** @type {number} */
            this.CRC = data.CRC;
            /** @type {SC3D} */
            this.container = data.container;
        } else {
            this.name = "";
            for (let c = 0; c < 4; ++c) this.name += String.fromCharCode(data[4 + c]);
            this.length = data.readUInt32BE(0);
            this.data = data.slice(8, this.length + 8);
            this.CRC = data.readUInt32BE(this.length + 8);
            let computedCRC = computeCRC(data.slice(4, this.length + 8));
            if (computedCRC !== this.CRC) console.warn(`CRC Mismatch for chunk ${this.name}: ` +
                `0x${this.CRC.toString(16).padStart(8, '0')} !== 0x${computedCRC.toString(16).padStart(8, '0')}`);
            this.container = container;
        }
    }
    parse() {
        switch (this.name) {
            case "HEAD":
                return new SC3DHeader(this);
            case "GEOM":
                return new SC3DGeometry(this);
            case "NODE":
                return new SC3DNodeList(this);
            case "WEND":
                return new SC3DWEND(this);
            case "MATE":
                return new SC3DMaterial(this);
            case "CAME":
                return new SC3DCamera(this);
            default:
                console.warn(`Unknown Chunk ${this.name}, ignoring...`);
        }
        return this;
    }

    toString() {
        return `${this.name}[${this.length}] {CRC=${this.CRC.toString(16).padStart(8, '0')}}`;
    }

    static get Header() {
        return SC3DHeader;
    }
    static get Geometry() {
        return SC3DGeometry;
    }
    static get NodeList() {
        return SC3DNodeList;
    }
    static get Camera() {
        return SC3DCamera;
    }
    static get Material() {
        return SC3DMaterial;
    }
}

class SC3DHeader extends SC3DChunk {
    constructor(item, c) {
        super(item, c);
        let ptr = 0;
        this.version = this.data.readInt16BE(ptr);
        const versionNames = ["BETA", "GLOBAL", "RELEASE2"];
        if (this.version < 2) console.warn(`Attempting to parse older SC3D version ${this.version} (${versionNames[this.version]}), parsing may fail`);
        else if (this.version > 2) console.warn(`Attempting to parse future SC3D version ${this.version}, parsing may fail or give incomplete results`);
        //TODO: Add support for older versions
        ptr += 2;
        this.val2 = this.data.readInt16BE(ptr);
        ptr += 2;
        this.val3 = this.data.readInt32BE(ptr);
        ptr += 4;
        const len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.libName = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.val4 = this.data.readUInt8(ptr++);
        /** @type {SC3D?} */
        this.library = null;
        if (this.libName) this.library = SC3D.importLib(this.libName);
        const leftOver = this.length - ptr;
        if (leftOver) console.warn(`H-> ${leftOver} bytes unprocessed`);
    }

    toString() {
        return `${super.toString()}; lib=${this.libName}, v1W=${this.version}, v2W=${this.val2}, v3D=${this.val3}, v4B=${this.val4}`;
    }
}

class SC3DGeometry extends SC3DChunk {
    constructor(item, c) {
        super(item, c);
        let len = this.data.readUInt16BE(0);
        let ptr = 2;
        this.geoName = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.group = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.props = {};
        let propCount = this.data.readUInt8(ptr++);
        /** @type {SC3DMesh[]} */
        this.meshes = [];

        for (let i = 0; i < propCount; ++i) {
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            let propName = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
            let propType = this.data.readUInt8(ptr++);
            let propIdx = this.data.readUInt8(ptr++);
            let propSize = this.data.readUInt8(ptr++) * 2;
            let propScale = this.data.readFloatBE(ptr);
            ptr += 4;
            let propCount = this.data.readUInt32BE(ptr);
            ptr += 4;
            let propLen = propCount * propSize;
            let propData = this.data.slice(ptr, ptr + propLen);
            ptr += propLen;
            let prop = { type: propType, itemSize: propSize, count: propCount, scale: propScale, data: propData, values: [] };
            if (!this.props[propName]) this.props[propName] = [];
            this.props[propName][propIdx] = prop;
        }
        this.hasMatrix = !!this.data.readUInt8(ptr++);
        this.shapeMatrix = this.hasMatrix ? SC3DGeometry.readMatrix4(this.data, ptr) : [];
        ptr += this.hasMatrix ? 64 : 0;
        let jointCount = this.data.readUInt8(ptr++);
        this.joints = [];
        for (let i = 0; i < jointCount; ++i) {
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            let jointName = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
            let joint = {
                name: jointName,
                matrix: SC3DGeometry.readMatrix4(this.data, ptr)
            };
            this.joints.push(joint);
            ptr += 64;
        }
        this.vertexWeights = [];
        let vertexWeightCount = this.data.readUInt32BE(ptr);
        ptr += 4;
        for (let i = 0; i < vertexWeightCount; ++i) {
            let vertW = {
                jointA: 0, jointB: 0, jointC: 0, jointD: 0,
                weightA: 0, weightB: 0, weightC: 0, weightD: 0
            };
            vertW.jointA = this.data.readUInt8(ptr++);
            vertW.jointB = this.data.readUInt8(ptr++);
            vertW.jointC = this.data.readUInt8(ptr++);
            vertW.jointD = this.data.readUInt8(ptr++);
            vertW.weightA = this.data.readUInt16BE(ptr) / 0xFFFF;
            ptr += 2;
            vertW.weightB = this.data.readUInt16BE(ptr) / 0xFFFF;
            ptr += 2;
            vertW.weightC = this.data.readUInt16BE(ptr) / 0xFFFF;
            ptr += 2;
            vertW.weightD = this.data.readUInt16BE(ptr) / 0xFFFF;
            ptr += 2;
            this.vertexWeights.push(vertW);
        }
        this.meshCount = this.data.readUInt8(ptr++);
        for (let i = 0; i < this.meshCount; ++i) {
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            const material = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            const str1 = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
            const triCount = this.data.readUInt16BE(ptr);
            ptr += 2;
            const triMode = this.data.readUInt16BE(ptr);
            ptr += 2;
            const triangles = SC3DMesh.readTriangles(this.data.slice(ptr), triCount, triMode);
            ptr += 3 * triCount * (triMode & 0xFF) * (triMode >> 8);
            this.meshes.push(new SC3DMesh(material, str1, triangles, this));
        }
        this.loadVertexData();
        const leftOver = this.length - ptr;
        if (leftOver) console.warn(`G-> ${leftOver} bytes unprocessed`);
    }
    loadVertexData() {
        let vecPositions = this.props.POSITION;
        let vecNormals = this.props.NORMAL;
        let vecTexCoords = this.props.TEXCOORD;
        let vecColors = this.props.COLOR;
        for (const propName in this.props) {
            const prop = this.props[propName];
            if (prop[0].type > 3) console.warn(`Unknown prop type ${prop[0].type} (${propName})`);
        }
        if (vecPositions) {
            for (const vecPos of vecPositions) {
                const vecData = vecPos.data;
                vecPos.values = [];
                for (let i = 0; i < vecData.length; i += vecPos.itemSize) {
                    vecPos.values.push(
                        new Vec3D(vecData.readInt16BE(i), vecData.readInt16BE(i + 2), vecData.readInt16BE(i + 4))
                            .scale(vecPos.scale / 0x7F00)
                    );
                }
            }
        }
        if (vecNormals) {
            for (const vecNorm of vecNormals) {
                const normData = vecNorm.data;
                vecNorm.values = [];
                for (let i = 0; i < normData.length; i += vecNorm.itemSize) {
                    vecNorm.values.push(
                        new Vec3D(normData.readInt16BE(i), normData.readInt16BE(i + 2), normData.readInt16BE(i + 4))
                            .scale(vecNorm.scale / 0x7F00)
                    );
                }
            }
        }
        if (vecTexCoords) {
            for (const texCoord of vecTexCoords) {
                texCoord.values = [];
                const texCoordData = texCoord.data;
                for (let i = 0; i < texCoordData.length; i += texCoord.itemSize) {
                    texCoord.values.push({
                        u: texCoordData.readInt16BE(i) * texCoord.scale / 0x7F00,
                        v: texCoordData.readInt16BE(i + 2) * texCoord.scale / 0x7F00
                    });
                }
            }
        }
        if (vecColors) {
            for (const color of vecColors) {
                const colorData = color.data;
                for (let i = 0; i < colorData.length; i += color.itemSize) {
                    const r = colorData.readUInt16BE(i) * color.scale / 0x7F00;
                    const g = colorData.readUInt16BE(i) * color.scale / 0x7F00;
                    const b = colorData.readUInt16BE(i) * color.scale / 0x7F00;
                    const a = color.itemSize === 8 ? (colorData.readUInt16BE(i) * color.scale / 0x7F00) : 1;
                    color.values.push({ r, g, b, a });
                }
            }
        }
    }

    toString() {
        const chunkData = super.toString();
        const geomData = `Geometry ${this.geoName}${this.group ? " <- " + this.group : ""}: ${this.meshes.length} meshes, ${this.joints.length} joints`;
        return `${chunkData}; ${geomData}` +
            (this.meshes.length ? "\n" + this.meshes.map(m => `\tMat: ${m.material}, s1=${m.str1}, ${m.triangles.length} triangles`).join('\n') : "") +
            (this.joints.length ? "\n\tJoints: " + this.joints.map(j => j.name).join(", ") : "");
    }

    static readMatrix4(data, ptr) {
        let matrix = [];
        for (let i = 0; i < 4 * 4; ++i) {
            matrix[i] = data.readFloatBE(ptr + i * 4);
        }
        return matrix;
    }

    static get Mesh() {
        return SC3DMesh;
    }
}

class SC3DMesh {
    /**
     * @param {string} material 
     * @param {string} str1 
     * @param {array} triangles 
     * @param {SC3DChunk} chunk 
     */
    constructor(material, str1, triangles, chunk) {
        this.chunk = chunk;
        this.material = material;
        this.str1 = str1;
        this.triangles = triangles;
    }

    /**
     * Reads the triangle list from the data
     * @param {Buffer} data 
     * @param {number} count 
     * @param {number} mode 
     */
    static readTriangles(data, count, mode) {
        const triSize = mode & 0xFF;
        const triMode = mode >> 8;
        const triIter = 3 * triSize * triMode;
        const sizeReadLUT = [null, "8", "16BE", null, "32BE"];
        if (!sizeReadLUT[triSize]) throw new RangeError("Invalid triSize " + triSize);
        const sizeRead = "readUInt" + sizeReadLUT[triSize];
        const triangles = [];
        for (let i = 0, o = 0; i < count; ++i, o += triIter) {
            const triangle = { A: 0, B: 0, C: 0, dataA: {}, dataB: {}, dataC: {} };
            triangle.A = data[sizeRead](o);
            triangle.B = data[sizeRead](o + triMode * triSize);
            triangle.C = data[sizeRead](o + 2 * triMode * triSize);
            switch (triMode) {
                case 4:
                    triangle.dataA.color = data[sizeRead](o + 3 * triSize);
                    triangle.dataB.color = data[sizeRead](o + triMode * triSize + 3 * triSize);
                    triangle.dataC.color = data[sizeRead](o + 2 * triMode * triSize + 3 * triSize);
                //falls through
                case 3:
                    triangle.dataA.texture = data[sizeRead](o + 2 * triSize);
                    triangle.dataB.texture = data[sizeRead](o + triMode * triSize + 2 * triSize);
                    triangle.dataC.texture = data[sizeRead](o + 2 * triMode * triSize + 2 * triSize);
                //falls through
                case 2:
                    triangle.dataA.normal = data[sizeRead](o + triSize);
                    triangle.dataB.normal = data[sizeRead](o + triMode * triSize + triSize);
                    triangle.dataC.normal = data[sizeRead](o + 2 * triMode * triSize + triSize);
                //falls through
                case 1:
                    break;
                default:
                    console.warn(`Unknown triMode ${triMode} (mode=${mode})`);
            }
            triangles.push(triangle);
        }
        return triangles;
    }

    static get Vec3D() {
        return Vec3D;
    }
}

class SC3DNodeList extends SC3DChunk {
    /**
     * Represents the NODE Chunk
     * @param {SC3DChunk} item 
     */
    constructor(item, c) {
        super(item, c);
        /** @type {SC3DNode[]} */
        this.nodes = [];
        let nodeCount = this.data.readUInt16BE(0);
        let ptr = 2;
        for (let i = 0; i < nodeCount; ++i) {
            let node = new SC3DNode(this.data.slice(ptr), this);
            ptr += node.ptrLen;
            this.nodes.push(node);
        }
    }

    toString() {
        return `${super.toString()}; ${this.nodes.length} nodes` +
            (this.nodes.length ? ":\n" + this.nodes.map(n => '\t' + n.toString().replace(/\n/g, "\n\t")).join('\n') : "");
    }
}

class SC3DNode {
    /**
     * @param {Buffer} data 
     * @param {SC3DNodeList} chunk 
     */
    constructor(data, chunk) {
        this.data = data;
        this.chunk = chunk;
        let ptr = 0, len = 0;
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.name = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.parent = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.hasTarget = !!this.data.readUInt16BE(ptr);
        ptr += 2;
        if (this.hasTarget) {
            this.targetType = this.data.toString("utf8", ptr, ptr + 4);
            ptr += 4;
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            this.targetName = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
            let bindCount = this.data.readUInt16BE(ptr);
            ptr += 2;
            this.bindings = [];
            for (let i = 0; i < bindCount; ++i) {
                len = this.data.readUInt16BE(ptr);
                ptr += 2;
                const symbol = this.data.toString("utf8", ptr, ptr + len);
                ptr += len;
                len = this.data.readUInt16BE(ptr);
                ptr += 2;
                const target = this.data.toString("utf8", ptr, ptr + len);
                ptr += len;
                this.bindings.push({ symbol, target });
            }
        }
        let frameCount = this.data.readUInt16BE(ptr);
        ptr += 2;
        /** @type {SC3DFrame[]} */
        this.frames = [];
        if (frameCount) {
            let flags = this.data.readUInt8(ptr++);
            this.animationFlags = flags;
            this.hasScaleX = !!(flags & (1 << 6));
            this.hasScaleY = !!(flags & (1 << 5));
            this.hasScaleZ = !!(flags & (1 << 4));
            this.hasPositionX = !!(flags & (1 << 3));
            this.hasPositionY = !!(flags & (1 << 2));
            this.hasPositionZ = !!(flags & (1 << 1));
            this.hasRotation = !!(flags & (1 << 0));
            const posCount = (this.hasPositionX ? 1 : 0) + (this.hasPositionY ? 1 : 0) + (this.hasPositionZ ? 1 : 0);
            const scaleCount = (this.hasScaleX ? 1 : 0) + (this.hasScaleY ? 1 : 0) + (this.hasScaleZ ? 1 : 0);
            for (let i = 0; i < frameCount; ++i) {
                const first = this.frames[0];
                let frameID = this.data.readUInt16BE(ptr);
                ptr += 2;
                let pos, rot, scale;
                if (this.hasRotation || !i) {
                    let rx = this.data.readInt16BE(ptr);
                    ptr += 2;
                    let ry = this.data.readInt16BE(ptr);
                    ptr += 2;
                    let rz = this.data.readInt16BE(ptr);
                    ptr += 2;
                    let rw = this.data.readInt16BE(ptr);
                    ptr += 2;
                    rot = new Quaternion(rx / 0x7F00, ry / 0x7F00, rz / 0x7F00, rw / 0x7F00);
                }
                if (posCount || !i) {
                    let p = [];
                    for (let pi = 0; pi < (i ? posCount : 3); ++pi) {
                        p.push(this.data.readFloatBE(ptr));
                        ptr += 4;
                    }
                    let px = (this.hasPositionX || !i) ? p.splice(0, 1)[0] : first.position.x;
                    let py = (this.hasPositionY || !i) ? p.splice(0, 1)[0] : first.position.y;
                    let pz = (this.hasPositionZ || !i) ? p.splice(0, 1)[0] : first.position.z;
                    pos = new Vec3D(px, py, pz);
                }
                if (scaleCount || !i) {
                    let s = [];
                    for (let si = 0; si < (i ? scaleCount : 3); ++si) {
                        s.push(this.data.readFloatBE(ptr));
                        ptr += 4;
                    }
                    let sx = (this.hasScaleX || !i) ? s.splice(0, 1)[0] : first.scale.x;
                    let sy = (this.hasScaleY || !i) ? s.splice(0, 1)[0] : first.scale.y;
                    let sz = (this.hasScaleZ || !i) ? s.splice(0, 1)[0] : first.scale.z;
                    scale = new Vec3D(sx, sy, sz);
                }
                this.frames.push(new SC3DFrame(this, frameID, pos || first.position, rot || first.position, scale || first.scale));
            }
        }
        this.ptrLen = ptr;
    }

    toString() {
        const nodeInfo = `${this.name}${this.parent ? " <- " + this.parent : ""}: ${this.frames.length} frames`;
        const targetInfo = this.hasTarget ? `Target: ${this.targetName} {${this.targetType}}` : "No target";
        return `${nodeInfo}, ${targetInfo}`;
    }
}

class SC3DFrame {
    /**
     * 
     * @param {SC3DNode} node 
     * @param {number} index 
     * @param {Vec3D} position 
     * @param {Quaternion} rotation 
     * @param {Vec3D} scale 
     */
    constructor(node, index, position, rotation, scale) {
        this.node = node;
        this.index = index;
        this.position = position;
        this.rotation = rotation;
        this.scale = scale;
    }
}

class SC3DMaterial extends SC3DChunk {
    constructor(item, c) {
        super(item, c);
        let len = this.data.readUInt16BE(0);
        let ptr = 2;
        this.matName = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.shader = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.val1 = this.data.readUInt8(ptr++);
        this.useAmbientTexture = !!this.data.readUInt8(ptr++);
        if (this.useAmbientTexture) {
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            this.ambientTexture = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
        } else {
            this.ambientColor = this.data.readUInt32BE(ptr);
            ptr += 4;
        }
        this.useDiffuseTexture = !!this.data.readUInt8(ptr++);
        if (this.useDiffuseTexture) {
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            this.diffuseTexture = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
        } else {
            this.diffuseColor = this.data.readUInt32BE(ptr);
            ptr += 4;
        }
        this.useStencilTexture = !!this.data.readUInt8(ptr++);
        if (this.useStencilTexture) {
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            this.stencilTexture = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
        } else {
            this.stencilColor = this.data.readUInt32BE(ptr);
            ptr += 4;
        }
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.str1 = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.str2 = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.useColorizeTexture = !!this.data.readUInt8(ptr++);
        if (this.useColorizeTexture) {
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            this.colorizeTexture = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
        } else {
            this.colorizeColor = this.data.readUInt32BE(ptr);
            ptr += 4;
        }
        this.useEmissionTexture = !!this.data.readUInt8(ptr++);
        if (this.useEmissionTexture) {
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            this.emissionTexture = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
        } else {
            this.emissionColor = this.data.readUInt32BE(ptr);
            ptr += 4;
        }
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.alphaTexture = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.val2 = this.data.readFloatBE(ptr);
        ptr += 4;
        this.val3 = this.data.readFloatBE(ptr);
        ptr += 4;
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.diffuseLightmap = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.specularLightmap = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.val4 = this.data.readFloatBE(ptr);
        ptr += 4;
        this.val5 = this.data.readUInt16BE(ptr);
        ptr += 2;
        const leftOver = this.length - ptr;
        if (leftOver) console.warn(`M-> ${leftOver} bytes unprocessed`);
    }

    toString() {
        const convertARGB = v => `ARGB: ${(v >> 24) & 0xFF}-${(v >> 16) & 0xFF}-${(v >> 8) & 0xFF}-${v & 0xFF}`;
        const matData = [];
        const unkData = ["v1B=" + this.val1, "v2F=" + this.val2, "v3F=" + this.val3, "v4F=" + this.val4, "v5W=" + this.val5, "st1=" + this.str1, "st2=" + this.str2, "st3=" + this.alphaTexture];
        if (this.shader) matData.push("Shader: " + this.shader);
        matData.push(this.useAmbientTexture ? "AmbientTex: " + this.ambientTexture : "AmbientCol: " + convertARGB(this.ambientColor));
        matData.push(this.useDiffuseTexture ? "DiffuseTex: " + this.diffuseTexture : "DiffuseCol: " + convertARGB(this.diffuseColor));
        matData.push(this.useStencilTexture ? "StencilTex: " + this.stencilTexture : "StencilCol: " + convertARGB(this.stencilColor));
        matData.push(this.useColorizeTexture ? "ColorizeTex: " + this.colorizeTexture : "ColorizeCol: " + convertARGB(this.colorizeColor));
        matData.push(this.useEmissionTexture ? "EmissionTex: " + this.emissionTexture : "EmissionCol: " + convertARGB(this.emissionColor));
        matData.push("DiffuseLM: " + this.diffuseLightmap);
        matData.push("SpecularLM: " + this.specularLightmap);
        return `${super.toString()}; Material ${this.matName}: ${matData.join(", ")}\n\tUnknown data: ${unkData.join(", ")}`;
    }

    static getRGBA(v) {
        return [(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF, (v >> 24) & 0xFF];
    }
}

class SC3DCamera extends SC3DChunk {
    constructor(item, c) {
        super(item, c);
        let len = this.data.readUInt16BE(0);
        let ptr = 2;
        this.camName = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.val1 = this.data.readFloatBE(ptr);
        ptr += 4;
        this.xFOV = this.data.readFloatBE(ptr);
        ptr += 4;
        this.aspectRatio = this.data.readFloatBE(ptr);
        ptr += 4;
        this.zNear = this.data.readFloatBE(ptr);
        ptr += 4;
        this.zFar = this.data.readFloatBE(ptr);
        ptr += 4;
        const leftOver = this.length - ptr;
        if (leftOver) console.warn(`C-> ${leftOver} bytes unprocessed`);
    }

    toString() {
        return `${super.toString()}; Camera ${this.camName}: xFOV=${this.xFOV}, aspR=${this.aspectRatio.toFixed(4)}, zNear=${this.zNear}, zFar=${this.zFar}, v1F=${this.val1}`;
    }
}

class SC3DWEND extends SC3DChunk { }

class Vec3D {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    get array() {
        return [this.x, this.y, this.z];
    }
    scale(v) {
        this.x *= v;
        this.y *= v;
        this.z *= v;
        return this;
    }
}

class Quaternion {
    constructor(x, y, z, w) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
}

module.exports = SC3D;