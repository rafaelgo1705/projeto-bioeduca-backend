import { db, storage } from "@utils/database";

import { PlantModel } from "@data/models/plant";
import { type PlantEntity } from "@data/entities/plant";
import { type ListPaginatedInputEntity } from "@data/entities/listPaginatedInput";
import { type IStoredPlantModel } from "@data/interfaces/models/plant";

export class PlantRepository {
	private readonly colletionName = "plants";
	private readonly storageName = "plants";

	constructor() {}

	async consultPlantById(id: string) {
		const doc = await db.collection(this.colletionName).doc(id).get();
		if (!doc.exists) return undefined;

		const { images, ...plantData } = doc.data() as IStoredPlantModel;
		const imageURLs = await this.listPlantImagesURLs(doc.id, images || []);
		return PlantModel.fromStore({ ...plantData, images: imageURLs, id: doc.id });
	}

	async list(listEntity: ListPaginatedInputEntity) {
		const lastSentPlantSnapshot = await (async (plantId: string | undefined) => {
			if (!plantId) return undefined;
			return await db.collection(this.colletionName).doc(plantId).get();
		})(listEntity.lastKey);

		const listQuery = db
			.collection(this.colletionName)
			.limit(listEntity.perPage + 1)
			.orderBy("created_at", "desc");

		const listSnapshot = await (async () => {
			if (lastSentPlantSnapshot) return await listQuery.startAfter(lastSentPlantSnapshot).get();
			return await listQuery.get();
		})();

		const queriedSnapshots = listSnapshot.docs.slice(0, listEntity.perPage);
		const plantModels: PlantModel[] = queriedSnapshots.map((plantDoc) => {
			const { images, ...plantData } = plantDoc.data() as IStoredPlantModel;
			return PlantModel.fromStore({ ...plantData, id: plantDoc.id });
		});

		return {
			hasMore: listSnapshot.size > plantModels.length,
			plantModels,
		};
	}

	async create(plantEntity: PlantEntity) {
		const { images, ...plantData } = plantEntity.export();

		const newPlantDocRef = db.collection(this.colletionName).doc();

		await ((images: Express.Multer.File[] | undefined) => {
			if (!images) return [] as string[];
			return this.storeImages(newPlantDocRef.id, images);
		})(images);

		const plantModel = new PlantModel({
			...plantData,
			images: images ? images.map((file) => file.filename || file.originalname) : [],
			id: newPlantDocRef.id,
		});

		const { id, ...plantModelData } = plantModel.export();

		await newPlantDocRef.set(plantModelData);

		return plantModel;
	}

	async listPlantImagesURLs(plantId: string, images: string[]): Promise<string[]> {
		const bucket = storage.bucket();
		const folderPublicURL = bucket.file(`${this.storageName}/${plantId}`).publicUrl();
		return images.map((imageName) => `${folderPublicURL}/${imageName}`);
	}

	async storeImages(plantId: string, images: Express.Multer.File[]) {
		return await Promise.all(images.map((file) => this.storeImage(plantId, file)));
	}

	async storeImage(plantId: string, image: Express.Multer.File) {
		const bucket = storage.bucket();
		const file = bucket.file(
			`${this.storageName}/${plantId}/${image.filename || image.originalname}`
		);

		await file.save(image.buffer, {
			public: true,
			metadata: {
				contentType: image.mimetype,
				cacheControl: "public, max-age=" + 60 * 60 * 24,
			},
		});

		return file.publicUrl();
	}
}
