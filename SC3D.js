/* eslint-disable no-debugger */
/* eslint-env node, es6 */

const XML = require("./XML");
const MAGIC = "SC3D";
const CRCTable = new Uint32Array(256);
let CRCInitialized = false;

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
     */
    constructor(data, name) {
        this.name = name || "unknown";
        this.data = data;
        if (data.compare(Buffer.from(MAGIC), 0, 3, 0, 3)) throw new TypeError("Invalid SC3D file");
        /** @type {SC3DChunk[]} */
        this.chunks = [];
    }
    load() {
        let ptr = MAGIC.length;
        while (ptr < this.data.length && !this.findChunk("WEND")) {
            let len = this.data.readUInt32BE(ptr) + 12;
            let chunk = new SC3DChunk(this.data.slice(ptr, ptr + len), this);
            this.chunks.push(chunk.parse());
            ptr += len;
        }
        return this;
    }
    findChunk(name) {
        return this.chunks.find(chk => chk.name === name);
    }
    findChunks(name) {
        return this.chunks.filter(chk => chk.name === name);
    }
    exportModel() {
        //TODO
        return new XML(new XML.Tag("COLLADA", [
            new XML.Tag("asset", [
                new XML.Tag("contributor",
                    new XML.Tag("authoring_tool", "SC3D.js (BlaCoiso)")
                ),
                new XML.Tag("created", new Date().toISOString()),
                new XML.Tag("up_axis", "Z_UP")
            ]),
            new XML.Tag("library_geometries", this.chunks.filter(c => c instanceof SC3DGeometry)
                .map(c => {
                    const name = c.type;
                    const mesh = new XML.Tag("mesh", [
                        new XML.Tag("source",
                            [
                                new XML.Tag("float_array",
                                    c.vertices.map(v => `${v.x} ${v.y} ${v.z}`).join(" "),
                                    [["id", name + "-positions-array"], ["count", c.vertices.length * 3]]
                                ),
                                new XML.Tag("technique_common",
                                    new XML.Tag("accessor", [
                                        new XML.Tag("param", null, [["name", "X"], ["type", "float"]]),
                                        new XML.Tag("param", null, [["name", "Y"], ["type", "float"]]),
                                        new XML.Tag("param", null, [["name", "Z"], ["type", "float"]])
                                    ], [["source", '#' + name + "-positions-array"], ["count", c.vertices.length], ["stride", 3]])
                                )
                            ], new XML.Attribute("id", name + "-positions")
                        ),
                        new XML.Tag("source",
                            [
                                new XML.Tag("float_array",
                                    c.normals.map(v => `${v.x} ${v.y} ${v.z}`).join(" "),
                                    [["id", name + "-normals-array"], ["count", c.normals.length * 3]]
                                ),
                                new XML.Tag("technique_common",
                                    new XML.Tag("accessor", [
                                        new XML.Tag("param", null, [["name", "X"], ["type", "float"]]),
                                        new XML.Tag("param", null, [["name", "Y"], ["type", "float"]]),
                                        new XML.Tag("param", null, [["name", "Z"], ["type", "float"]])
                                    ], [["source", '#' + name + "-normals-array"], ["count", c.normals.length], ["stride", 3]])
                                )
                            ], new XML.Attribute("id", name + "-normals")
                        ),
                        new XML.Tag("source",
                            [
                                new XML.Tag("float_array",
                                    c.textureCoords.map(v => `${v.u} ${1 - v.v}`).join(" "),
                                    [["id", name + "-uv-array"], ["count", c.textureCoords.length * 2]]
                                ),
                                new XML.Tag("technique_common",
                                    new XML.Tag("accessor", [
                                        new XML.Tag("param", null, [["name", "S"], ["type", "float"]]),
                                        new XML.Tag("param", null, [["name", "T"], ["type", "float"]])
                                    ], [["source", '#' + name + "-uv-array"], ["count", c.textureCoords.length], ["stride", 2]])
                                )
                            ], new XML.Attribute("id", name + "-texCoords")
                        ),
                        new XML.Tag("vertices",
                            new XML.Tag("input", null,
                                [["semantic", "POSITION"], ["source", '#' + name + "-positions"]]
                            ), new XML.Attribute("id", name + "-vertices")
                        ),
                        new XML.Tag("triangles", [
                            new XML.Tag("input", null, [["semantic", "VERTEX"], ["source", '#' + name + "-vertices"], ["offset", 0]]),
                            new XML.Tag("input", null, [["semantic", "NORMAL"], ["source", '#' + name + "-normals"], ["offset", 1]]),
                            new XML.Tag("input", null, [["semantic", "TEXCOORD"], ["source", '#' + name + "-texCoords"], ["offset", 2], ["set", 0]]),
                            new XML.Tag("p", c.triangles.map(t => `${t.A} ${t.dataA.normal} ${t.dataA.texture} ` +
                                `${t.B} ${t.dataB.normal} ${t.dataB.texture} ` + `${t.C} ${t.dataC.normal} ${t.dataC.texture}`).join(" ")
                            )
                        ], [["material", c.material], ["count", c.triangles.length]]
                        )
                    ]);
                    const tag = new XML.Tag("geometry", mesh, [["id", name], ["name", name]]);
                    return tag;
                    //TODO
                })),
            new XML.Tag("library_controllers"),//Include joints and bones and whatever here
            new XML.Tag("library_visual_scenes", new XML.Tag("visual_scene",
                this.findChunk("NODE").nodes.filter(n => n.targetName).map(n => {
                    const tag = new XML.Tag("node", new XML.Tag("instance_geometry", null, new XML.Attribute("url", '#' + n.targetName)),
                        [["id", n.name], ["type", "NODE"]]);
                    return tag;
                })
                , [["id", "Scene"], ["name", "Scene"]])),
            new XML.Tag("scene", new XML.Tag("instance_visual_scene", null, new XML.Attribute("url", "#Scene")))
        ], [
            ["xmlns", "http://www.collada.org/2005/11/COLLADASchema"],
            ["version", "1.4.1"]]
        )).generate(true);
    }

    static get Chunk() {
        return SC3DChunk;
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

    static get Header() {
        return SC3DHeader;
    }
    static get Geometry() {
        return SC3DGeometry;
    }
    static get Node() {
        return SC3DNodeList;
    }
    static get Camera() {
        return SC3DCamera;
    }
}

class SC3DHeader extends SC3DChunk {
    constructor(item, c) {
        super(item, c);
        this.val1 = this.data.readInt16BE(0);
        this.val2 = this.data.readInt16BE(2);
        this.val3 = this.data.readInt32BE(4);
        const len = this.data.readUInt16BE(8);
        if (this.val1 !== 2) {
            console.warn(`v1{${this.val1}} != 2`);
            debugger;
        }
        if (this.val2 !== 30) {
            console.warn(`v2{${this.val2}} != 30`);
            debugger;
        }
        //console.log(`H -> ${this.val3}`);
        this.string = this.data.toString("utf8", 10, 10 + len);
    }
}

class SC3DGeometry extends SC3DChunk {
    constructor(item, c) {
        super(item, c);
        let len = this.data.readUInt16BE(0);
        let ptr = 2;
        this.type = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.group = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.props = {};
        let propCount = this.data.readUInt8(ptr++);
        this.vertices = [];
        this.normals = [];
        this.textureCoords = [];
        this.colors = [];

        for (let i = 0; i < propCount; ++i) {
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            let propName = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
            let propType = this.data.readUInt8(ptr++);
            let propIdx = this.data.readUInt8(ptr++);
            let propSize = this.data.readUInt8(ptr++) * 2;
            if (propIdx) propName += "SEC";
            let propScale = this.data.readFloatBE(ptr);
            ptr += 4;
            let propCount = this.data.readUInt32BE(ptr);
            ptr += 4;
            let propLen = propCount * propSize;
            let propData = this.data.slice(ptr, ptr + propLen);
            ptr += propLen;
            let prop = { type: propType, itemSize: propSize, count: propCount, scale: propScale, data: propData };
            this.props[propName] = prop;
        }
        this.hasDoubleMesh = !!this.props.TEXCOORDSEC;
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
            vertW.weightA = this.data.readInt16BE(ptr);
            ptr += 2;
            vertW.weightB = this.data.readInt16BE(ptr);
            ptr += 2;
            vertW.weightC = this.data.readInt16BE(ptr);
            ptr += 2;
            vertW.weightD = this.data.readInt16BE(ptr);
            ptr += 2;
            this.vertexWeights.push(vertW);
        }
        this.val2 = this.data.readUInt8(ptr++);
        if (this.val2 !== 1) {
            console.warn(`G[${this.container.chunks.length}] v2{${this.val2}} != 1`);
            debugger;
        }
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.material = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.str1 = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        const triCount = this.data.readUInt16BE(ptr);
        ptr += 2;
        const triMode = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.triangles = SC3DGeometry.readTriangles(this.data.slice(ptr), triCount, triMode);
        ptr += 3 * triCount * (triMode & 0xFF) * (triMode >> 8);
        if (this.hasDoubleMesh && ptr + 2 >= this.length) {
            this.hasDoubleMesh = false;
            console.warn("False-positive detection of double mesh");
        }
        if (this.hasDoubleMesh) {
            console.log("Found double mesh");
            //Has second mesh, load its stuff
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            this.material2 = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
            len = this.data.readUInt16BE(ptr);
            ptr += 2;
            this.str2 = this.data.toString("utf8", ptr, ptr + len);
            ptr += len;
            const triCount2 = this.data.readUInt16BE(ptr);
            ptr += 2;
            const triMode2 = this.data.readUInt16BE(ptr);
            ptr += 2;
            this.triangles2 = SC3DGeometry.readTriangles(this.data.slice(ptr), triCount2, triMode2);
            this.textureCoords2 = [];
        }
        this.loadVertexData();
        const leftOver = this.length - ptr;
        if (leftOver) console.warn(`G-> ${leftOver} bytes unprocessed`);
    }
    loadVertexData() {
        let vecPos = this.props.POSITION;
        let vecNorm = this.props.NORMAL;
        let vecTexCoord = this.props.TEXCOORD;
        let vecTexCoord2 = this.props.TEXCOORDSEC;
        let vecColor = this.props.COLOR;
        for (const propName in this.props) {
            const prop = this.props[propName];
            switch (prop.type) {
                case 0:
                    vecPos = vecPos || prop;
                    break;
                case 1:
                    vecNorm = vecNorm || prop;
                    break;
                case 2:
                    vecTexCoord = vecTexCoord || prop;
                    break;
                case 3:
                    vecColor = vecColor || prop;
                    break;
                default:
                    console.warn("Unknown prop type " + prop.type);
                    debugger;
            }
        }
        if (!vecPos) return; //No vertex data
        const vecData = vecPos.data;
        for (let i = 0; i < vecData.length; i += vecPos.itemSize) {
            this.vertices.push(
                new Vec3D(vecData.readInt16BE(i), vecData.readInt16BE(i + 2), vecData.readInt16BE(i + 4))
                    .scale(vecPos.scale / 0x7F00)
            );
        }
        if (vecNorm) {
            const normData = vecNorm.data;
            for (let i = 0; i < normData.length; i += vecNorm.itemSize) {
                this.normals.push(
                    new Vec3D(normData.readInt16BE(i), normData.readInt16BE(i + 2), normData.readInt16BE(i + 4))
                        .scale(vecNorm.scale / 0x7F00)
                );
            }
            if (vecTexCoord) {
                const texCoordData = vecTexCoord.data;
                for (let i = 0; i < texCoordData.length; i += vecTexCoord.itemSize) {
                    this.textureCoords.push({
                        u: texCoordData.readInt16BE(i) * vecTexCoord.scale / 0x7F00,
                        v: texCoordData.readInt16BE(i + 2) * vecTexCoord.scale / 0x7F00
                    });
                }
            }
            if (vecTexCoord2 && this.hasDoubleMesh) {
                const texCoord2Data = vecTexCoord2.data;
                for (let i = 0; i < texCoord2Data.length; i += vecTexCoord2.itemSize) {
                    this.textureCoords2.push({
                        u: texCoord2Data.readInt16BE(i) * vecTexCoord2.scale / 0x7FFF,
                        v: texCoord2Data.readInt16BE(i + 2) * vecTexCoord2.scale / 0x7FFF
                    });
                }
            }
        }
        if (vecColor) {
            const colorData = vecColor.data;
            for (let i = 0; i < colorData.length; i += vecColor.itemSize) {
                const r = colorData.readUInt16BE(i) * vecColor.scale / 0x7F00;
                const g = colorData.readUInt16BE(i) * vecColor.scale / 0x7F00;
                const b = colorData.readUInt16BE(i) * vecColor.scale / 0x7F00;
                const a = vecColor.itemSize === 8 ? (colorData.readUInt16BE(i) * vecColor.scale / 0x7F00) : 1;
                this.colors.push({ r, g, b, a });
            }
        }
    }

    static readMatrix4(data, ptr) {
        let matrix = [];
        for (let i = 0, x = 0, y = 0; i < 4 * 4; ++i, x = i % 4, y = (i / 4) | 0) {
            if (!matrix[x]) matrix[x] = [];
            matrix[x][y] = data.readFloatBE(ptr + i * 4);
        }
        return matrix;
    }

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
        this.nodes = [];
        let nodeCount = this.data.readUInt16BE(0);
        let ptr = 2;
        for (let i = 0; i < nodeCount; ++i) {
            let node = new SC3DNode(this.data.slice(ptr), this);
            ptr += node.ptrLen;
            this.nodes.push(node);
        }
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
            let targetCount = this.data.readUInt16BE(ptr);
            ptr += 2;
            /** @type {string[]} */
            this.targets = [];
            for (let i = 0; i < targetCount * 2; ++i) {
                len = this.data.readUInt16BE(ptr);
                ptr += 2;
                this.targets.push(this.data.toString("utf8", ptr, ptr + len));
                ptr += len;
            }
        }
        let frameCount = this.data.readUInt16BE(ptr);
        ptr += 2;
        if (frameCount) {
            let flags = this.data.readUInt8(ptr++);
            this.hasScaleX = !!(flags & (1 << 6));
            this.hasScaleY = !!(flags & (1 << 5));
            this.hasScaleZ = !!(flags & (1 << 4));
            this.hasPositionX = !!(flags & (1 << 3));
            this.hasPositionY = !!(flags & (1 << 2));
            this.hasPositionZ = !!(flags & (1 << 1));
            this.hasRotation = !!(flags & (1 << 0));
            /** @type {SC3DFrame[]} */
            this.frames = [];
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
        this.name = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        len = this.data.readUInt16BE(ptr);
        ptr += 2;
        this.shader = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.val1 = this.data.readUInt8(ptr++);
        this.useAmbientTexture = !!this.data.readUInt8(ptr++);
        //TODO continue this
        //throw new Error("TODO UNIMPL MATERIAL");
    }
}

class SC3DCamera extends SC3DChunk {
    constructor(item, c) {
        super(item, c);
        let len = this.data.readUInt16BE(0);
        let ptr = 2;
        this.name = this.data.toString("utf8", ptr, ptr + len);
        ptr += len;
        this.val1 = this.data.readFloatBE(ptr);
        ptr += 4;
        this.val2 = this.data.readFloatBE(ptr);
        ptr += 4;
        this.val3 = this.data.readFloatBE(ptr);
        ptr += 4;
        this.val4 = this.data.readFloatBE(ptr);
        ptr += 4;
        this.val5 = this.data.readFloatBE(ptr);
        ptr += 4;
        //throw new Error("TODO UNIMPL CAMERA");
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