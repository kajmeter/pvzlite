// RTS camera: fixed pitch, smooth panning, zoom, edge scrolling, terrain following.
import * as THREE from 'three';

export class RTSCamera {
  constructor(camera, map, heightAt) {
    this.camera = camera;
    this.map = map;
    this.heightAt = heightAt;
    this.target = new THREE.Vector3(map.width / 2, 0, map.height / 2);
    this.ground = 0;
    this.distance = 30;
    this.targetDistance = 30;
    this.minDist = 10;
    this.maxDist = 52;
    this.pitch = THREE.MathUtils.degToRad(56);
    this.yaw = 0;
    this.keys = { left: false, right: false, up: false, down: false };
    this.edge = { x: 0, y: 0 };
    this.edgeScroll = true;
    this.speed = 1;
    this.dragging = null;
    this.shake = 0;
    this.orbit = false; // attract-mode orbit
  }

  jumpTo(x, y) {
    this.target.x = x;
    this.target.z = y;
    this.clamp();
  }

  zoom(delta) {
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * (delta > 0 ? 1.12 : 1 / 1.12), this.minDist, this.maxDist);
  }

  clamp() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, 4, this.map.width - 4);
    this.target.z = THREE.MathUtils.clamp(this.target.z, 6, this.map.height - 2);
  }

  update(dt) {
    const pan = (18 + this.distance * 0.9) * this.speed * dt;
    let dx = 0;
    let dz = 0;
    if (this.keys.left) dx -= 1;
    if (this.keys.right) dx += 1;
    if (this.keys.up) dz -= 1;
    if (this.keys.down) dz += 1;
    if (this.edgeScroll && !this.dragging) {
      dx += this.edge.x;
      dz += this.edge.y;
    }
    if (this.orbit) {
      this.yaw += dt * 0.04;
    }
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.target.x += (dx * cy - dz * sy) * pan;
    this.target.z += (dx * sy + dz * cy) * pan;
    this.clamp();
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 10);
    const gh = Math.max(0, this.heightAt(this.target.x, this.target.z));
    this.ground += (gh - this.ground) * Math.min(1, dt * 4);
    this.apply();
  }

  apply() {
    const d = this.distance;
    const off = new THREE.Vector3(0, Math.sin(this.pitch) * d, Math.cos(this.pitch) * d);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    const look = new THREE.Vector3(this.target.x, this.ground, this.target.z);
    this.camera.position.copy(look).add(off);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - 0.05);
    }
    this.camera.lookAt(look);
  }
}
